import 'server-only';
import { Prisma, type KnowledgeSourceKind } from '@prisma/client';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { withDbBudget, dbNow } from '../jobs/db-budget';
import { getIntelligenceSettings, resolveEffectivePolicy } from '../settings/service';
import { registerAiGateway, AiGatewayError } from '../ai/gateway';
import { BACKGROUND_EMBEDDING_ACTOR } from '../ai/contract';
import { resolveEmbeddingModel } from '../ai/port';
import { normalizeVector } from '../semantic/vector';
import {
  buildChunks,
  DERIVED_KNOWLEDGE_KINDS,
  INCIDENT_KNOWLEDGE_KINDS,
  KNOWLEDGE_LIMITS,
  postmortemKnowledgeBody,
  readRunbookSteps,
  runbookStepChunks,
  type DerivedKnowledgeKind,
  type KnowledgeChunkDraft,
} from './contract';
import { getSquireMemorySettings } from './settings';

type Tx = Prisma.TransactionClient;
type Budget = { maxDbMs: number; fingerprintRetentionDays: number };

const EPOCH = new Date(0);
const cursorName = (kind: string) => `squire-knowledge:${kind}`;
const DAY_MS = 86_400_000;

/** Where a chunk sits for scoping and cascades; every chunk of one source shares it. */
interface SourceScope {
  serviceId: string | null;
  teamId: string | null;
  incidentId: string | null;
  postmortemId?: string | null;
  incidentNoteId?: string | null;
  runbookId?: string | null;
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
}

/** One source as the sync sees it: its chunks, or null when it must leave the index. */
interface SyncSource {
  sourceId: string;
  scope: SourceScope;
  chunks: KnowledgeChunkDraft[] | null;
}

interface Cursor {
  watermarkAt: Date;
  lastId: string;
}

async function readCursor(tx: Tx, kind: string): Promise<Cursor> {
  const row = await tx.intelligenceCursor.findUnique({
    where: { name: cursorName(kind) },
    select: { watermarkAt: true, lastId: true },
  });
  return row ?? { watermarkAt: EPOCH, lastId: '' };
}

/**
 * Advances the keyset only from the position this pass started at, so a racing pass (which the coalesced
 * work item already prevents) can never move it backwards.
 */
async function advanceCursor(tx: Tx, kind: string, from: Cursor, to: Cursor): Promise<void> {
  const name = cursorName(kind);
  const moved = await tx.intelligenceCursor.updateMany({
    where: { name, watermarkAt: from.watermarkAt, lastId: from.lastId },
    data: { watermarkAt: to.watermarkAt, lastId: to.lastId },
  });
  if (moved.count === 0 && from.watermarkAt.getTime() === EPOCH.getTime() && from.lastId === '') {
    await tx.intelligenceCursor.createMany({
      data: [{ name, watermarkAt: to.watermarkAt, lastId: to.lastId }],
      skipDuplicates: true,
    });
  }
}

/** `(ts, id) > (watermark, lastId)` and old enough that a late commit cannot be skipped. */
function after<T>(field: string, cursor: Cursor, upper: Date): T {
  return {
    AND: [
      { [field]: { lte: upper } },
      {
        OR: [
          { [field]: { gt: cursor.watermarkAt } },
          { [field]: cursor.watermarkAt, id: { gt: cursor.lastId } },
        ],
      },
    ],
  } as T;
}

export interface KnowledgeSyncResult {
  scanned: Record<DerivedKnowledgeKind, number>;
  written: number;
  removed: number;
  pruned: number;
  embedded: number;
  more: boolean;
}

/**
 * Brings the knowledge index up to date with a bounded batch of each source kind, oldest change first. Each kind
 * is its own budgeted transaction (rows and the cursor commit together), so a slow kind never blocks the others.
 * Incident-linked text follows the incident's intelligence policy (nothing is kept for a service whose policy is
 * OFF) and the fingerprint retention (expired incidents are never re-indexed).
 */
export async function syncKnowledgePass(
  budget: Budget,
  options: { batch?: number; signal?: AbortSignal; now?: Date } = {}
): Promise<KnowledgeSyncResult> {
  const batch = Math.max(1, Math.min(options.batch ?? KNOWLEDGE_LIMITS.syncBatch, 500));
  const policyCache = new Map<string, Promise<boolean>>();
  const serviceActive = (serviceId: string) => {
    let pending = policyCache.get(serviceId);
    if (!pending) {
      pending = resolveEffectivePolicy(serviceId).then(policy => policy.effectiveMode !== 'OFF');
      policyCache.set(serviceId, pending);
    }
    return pending;
  };
  const result: KnowledgeSyncResult = {
    scanned: { POSTMORTEM: 0, RUNBOOK_STEP: 0, RESOLUTION_NOTE: 0, INCIDENT_NOTE: 0 },
    written: 0,
    removed: 0,
    pruned: 0,
    embedded: 0,
    more: false,
  };

  for (const kind of DERIVED_KNOWLEDGE_KINDS) {
    if (options.signal?.aborted) break;
    try {
      const outcome = await withDbBudget(budget, async tx => {
        const now = options.now ?? (await dbNow(tx));
        const upper = new Date(now.getTime() - KNOWLEDGE_LIMITS.settleMs);
        const retentionCutoff = new Date(now.getTime() - budget.fingerprintRetentionDays * DAY_MS);
        const cursor = await readCursor(tx, kind);
        // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed derived-kind list
        const { sources, next, scanned } = await LOADERS[kind](tx, cursor, upper, batch);
        let written = 0;
        let removed = 0;
        const existing = await tx.knowledgeChunk.findMany({
          where: { sourceKind: kind, sourceId: { in: sources.map(source => source.sourceId) } },
          select: { sourceId: true, chunkIndex: true, contentHash: true },
        });
        const hashes = new Map(
          existing.map(row => [`${row.sourceId}:${row.chunkIndex}`, row.contentHash])
        );
        for (const source of sources) {
          const expired =
            (INCIDENT_KNOWLEDGE_KINDS as readonly string[]).includes(kind) &&
            source.scope.sourceCreatedAt < retentionCutoff;
          const inactive =
            source.scope.serviceId !== null && !(await serviceActive(source.scope.serviceId));
          const chunks = expired || inactive ? null : source.chunks;
          const outcome = await writeSource(tx, kind, source, chunks ?? [], hashes);
          written += outcome.written;
          removed += outcome.removed;
        }
        if (next) await advanceCursor(tx, kind, cursor, next);
        return { scanned, written, removed, full: scanned >= batch };
      });
      // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed derived-kind list
      result.scanned[kind] = outcome.scanned;
      result.written += outcome.written;
      result.removed += outcome.removed;
      if (outcome.full) result.more = true;
      if (outcome.written > 0)
        addOperationalMetric('opsknight_squire_knowledge_chunks_written_total', outcome.written, {
          kind,
        });
    } catch (error) {
      // One kind failing (timeout, contention) never stops the others; the next pass resumes its cursor.
      result.more = true;
      logger.warn('[Squire] Knowledge sync step failed; other kinds continue', {
        kind,
        error: error instanceof Error ? error.name : 'error',
      });
    }
  }

  try {
    const pruned = await pruneInactiveServices(budget, serviceActive, batch * 2);
    result.pruned = pruned.removed;
    if (pruned.full) result.more = true;
  } catch (error) {
    logger.warn('[Squire] Knowledge prune step failed; will retry', {
      error: error instanceof Error ? error.name : 'error',
    });
  }

  if (!options.signal?.aborted) {
    const embedded = await embedPendingChunks(budget, options.signal);
    result.embedded = embedded.embedded;
    if (embedded.full) result.more = true;
  }
  return result;
}

async function writeSource(
  tx: Tx,
  kind: KnowledgeSourceKind,
  source: SyncSource,
  chunks: KnowledgeChunkDraft[],
  hashes: Map<string, string>
): Promise<{ written: number; removed: number }> {
  let written = 0;
  for (const chunk of chunks) {
    if (hashes.get(`${source.sourceId}:${chunk.chunkIndex}`) === chunk.contentHash) continue;
    const data = {
      ...source.scope,
      title: chunk.title,
      text: chunk.text,
      contentHash: chunk.contentHash,
      // New text needs a new vector; the embedding pass picks it up.
      embedding: [],
      embeddingModel: null,
    };
    await tx.knowledgeChunk.upsert({
      where: {
        sourceKind_sourceId_chunkIndex: {
          sourceKind: kind,
          sourceId: source.sourceId,
          chunkIndex: chunk.chunkIndex,
        },
      },
      create: {
        sourceKind: kind,
        sourceId: source.sourceId,
        chunkIndex: chunk.chunkIndex,
        ...data,
      },
      update: data,
    });
    written += 1;
  }
  const removed = await tx.knowledgeChunk.deleteMany({
    where: { sourceKind: kind, sourceId: source.sourceId, chunkIndex: { gte: chunks.length } },
  });
  return { written, removed: removed.count };
}

type Loader = (
  tx: Tx,
  cursor: Cursor,
  upper: Date,
  batch: number
) => Promise<{ sources: SyncSource[]; next: Cursor | null; scanned: number }>;

const incidentScope = (incident: {
  id: string;
  serviceId: string;
  teamId: string | null;
  createdAt: Date;
  service: { teamId: string | null };
}) => ({
  serviceId: incident.serviceId,
  teamId: incident.teamId ?? incident.service.teamId,
  incidentId: incident.id,
  sourceCreatedAt: incident.createdAt,
});

const INCIDENT_SELECT = {
  id: true,
  title: true,
  serviceId: true,
  teamId: true,
  createdAt: true,
  service: { select: { teamId: true } },
} as const;

const LOADERS: Record<DerivedKnowledgeKind, Loader> = {
  POSTMORTEM: async (tx, cursor, upper, batch) => {
    const rows = await tx.postmortem.findMany({
      where: after<Prisma.PostmortemWhereInput>('updatedAt', cursor, upper),
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: batch,
      select: {
        id: true,
        title: true,
        summary: true,
        rootCause: true,
        resolution: true,
        lessons: true,
        updatedAt: true,
        incident: { select: INCIDENT_SELECT },
      },
    });
    const last = rows.at(-1);
    return {
      scanned: rows.length,
      next: last ? { watermarkAt: last.updatedAt, lastId: last.id } : null,
      sources: rows.map(row => ({
        sourceId: row.id,
        scope: {
          ...incidentScope(row.incident),
          postmortemId: row.id,
          sourceUpdatedAt: row.updatedAt,
        },
        chunks: buildChunks(row.title, postmortemKnowledgeBody(row)),
      })),
    };
  },
  INCIDENT_NOTE: async (tx, cursor, upper, batch) => {
    const rows = await tx.incidentNote.findMany({
      where: after<Prisma.IncidentNoteWhereInput>('createdAt', cursor, upper),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batch,
      select: { id: true, content: true, createdAt: true, incident: { select: INCIDENT_SELECT } },
    });
    const last = rows.at(-1);
    return {
      scanned: rows.length,
      next: last ? { watermarkAt: last.createdAt, lastId: last.id } : null,
      sources: rows.map(row => ({
        sourceId: row.id,
        scope: {
          ...incidentScope(row.incident),
          incidentNoteId: row.id,
          sourceUpdatedAt: row.createdAt,
        },
        // Acknowledgement-sized notes ("on it", "ack") are not knowledge.
        chunks:
          row.content.trim().length < 20
            ? []
            : buildChunks(`Note on: ${row.incident.title}`, row.content),
      })),
    };
  },
  RESOLUTION_NOTE: async (tx, cursor, upper, batch) => {
    const rows = await tx.incident.findMany({
      where: {
        AND: [
          { resolvedAt: { not: null } },
          after<Prisma.IncidentWhereInput>('resolvedAt', cursor, upper),
        ],
      },
      orderBy: [{ resolvedAt: 'asc' }, { id: 'asc' }],
      take: batch,
      select: { ...INCIDENT_SELECT, status: true, resolvedAt: true },
    });
    const events = rows.length
      ? await tx.incidentEvent.findMany({
          where: {
            incidentId: { in: rows.map(row => row.id) },
            type: { in: ['MANUAL_RESOLVED', 'AUTO_RESOLVED'] },
          },
          orderBy: [{ incidentId: 'asc' }, { createdAt: 'desc' }],
          distinct: ['incidentId'],
          select: { incidentId: true, message: true },
        })
      : [];
    const message = new Map(events.map(event => [event.incidentId, event.message]));
    const last = rows.at(-1);
    return {
      scanned: rows.length,
      next: last?.resolvedAt ? { watermarkAt: last.resolvedAt, lastId: last.id } : null,
      sources: rows.map(row => ({
        sourceId: row.id,
        scope: { ...incidentScope(row), sourceUpdatedAt: row.resolvedAt ?? row.createdAt },
        chunks:
          row.status === 'RESOLVED' && message.get(row.id)
            ? buildChunks(`Resolved: ${row.title}`, message.get(row.id) ?? '')
            : null,
      })),
    };
  },
  RUNBOOK_STEP: async (tx, cursor, upper, batch) => {
    const rows = await tx.runbook.findMany({
      where: after<Prisma.RunbookWhereInput>('updatedAt', cursor, upper),
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: batch,
      select: {
        id: true,
        name: true,
        archivedAt: true,
        ownerTeamId: true,
        createdAt: true,
        updatedAt: true,
        publishedVersion: { select: { definition: true } },
      },
    });
    const last = rows.at(-1);
    return {
      scanned: rows.length,
      next: last ? { watermarkAt: last.updatedAt, lastId: last.id } : null,
      sources: rows.map(row => ({
        sourceId: row.id,
        // Runbook visibility follows its service bindings, which change on their own; it is decided at read
        // time through the reader's runbook rules, so the chunk carries no service or team.
        scope: {
          serviceId: null,
          teamId: null,
          incidentId: null,
          runbookId: row.id,
          sourceCreatedAt: row.createdAt,
          sourceUpdatedAt: row.updatedAt,
        },
        chunks:
          row.archivedAt || !row.publishedVersion
            ? null
            : runbookStepChunks(row.name, readRunbookSteps(row.publishedVersion.definition)),
      })),
    };
  },
};

/**
 * Removes derived chunks of services whose intelligence policy is now OFF, a bounded slice per pass on its own
 * keyset over chunk ids. Human-approved facts are kept: they are a person's record, not derived data.
 */
async function pruneInactiveServices(
  budget: Budget,
  serviceActive: (serviceId: string) => Promise<boolean>,
  limit: number
): Promise<{ removed: number; full: boolean }> {
  return withDbBudget(budget, async tx => {
    const cursor = await readCursor(tx, 'prune');
    const rows = await tx.knowledgeChunk.findMany({
      where: {
        id: { gt: cursor.lastId },
        serviceId: { not: null },
        sourceKind: { not: 'SERVICE_FACT' },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, serviceId: true },
    });
    const inactive: string[] = [];
    for (const serviceId of new Set(rows.map(row => row.serviceId as string)))
      if (!(await serviceActive(serviceId))) inactive.push(serviceId);
    const ids = rows.filter(row => inactive.includes(row.serviceId as string)).map(row => row.id);
    const removed = ids.length
      ? (await tx.knowledgeChunk.deleteMany({ where: { id: { in: ids } } })).count
      : 0;
    // Wraps around at the end so a later policy change is seen on the next lap.
    const next =
      rows.length < limit
        ? { watermarkAt: EPOCH, lastId: '' }
        : { watermarkAt: EPOCH, lastId: rows.at(-1)!.id };
    if (next.lastId !== cursor.lastId) await advanceCursor(tx, 'prune', cursor, next);
    return { removed, full: rows.length >= limit };
  });
}

/**
 * Optional vectors for the semantic re-rank, through the same background embedding identity and budget share as
 * incident embeddings. Off (and free) unless an administrator configured an embedding provider allowed to
 * receive Personal data. A budget or rate pause simply waits for the next pass.
 */
export async function embedPendingChunks(
  budget: Pick<Budget, 'maxDbMs'>,
  signal?: AbortSignal
): Promise<{ embedded: number; full: boolean }> {
  try {
    if (!(await getIntelligenceSettings()).enabled) return { embedded: 0, full: false };
    registerAiGateway();
    const port = await resolveEmbeddingModel('PERSONAL');
    if (!port) return { embedded: 0, full: false };
    const model = port.model;
    const pending = await withDbBudget(budget, tx =>
      tx.knowledgeChunk.findMany({
        where: {
          OR: [
            { embeddingModel: null },
            { embeddingModel: { lt: model } },
            { embeddingModel: { gt: model } },
          ],
        },
        take: KNOWLEDGE_LIMITS.embedBatch,
        select: { id: true, title: true, text: true, contentHash: true },
      })
    );
    if (pending.length === 0 || signal?.aborted) return { embedded: 0, full: false };
    const { vectors } = await port.embed(
      pending.map(chunk => `${chunk.title}\n${chunk.text}`),
      { actorId: BACKGROUND_EMBEDDING_ACTOR, signal }
    );
    let embedded = 0;
    await withDbBudget(budget, async tx => {
      for (const [index, chunk] of pending.entries()) {
        const vector = normalizeVector(vectors.at(index) ?? []);
        // A chunk whose text changed meanwhile keeps waiting for a vector of its new text.
        const updated = await tx.knowledgeChunk.updateMany({
          where: { id: chunk.id, contentHash: chunk.contentHash },
          data: vector ? { embedding: vector, embeddingModel: model } : { embeddingModel: model },
        });
        embedded += updated.count;
      }
    });
    return { embedded, full: pending.length >= KNOWLEDGE_LIMITS.embedBatch };
  } catch (error) {
    if (
      error instanceof AiGatewayError &&
      (error.code === 'BUDGET_EXHAUSTED' || error.code === 'RATE_LIMITED')
    )
      return { embedded: 0, full: false };
    logger.warn('[Squire] Knowledge embedding pass failed; lexical search is unaffected', {
      error: error instanceof Error ? error.name : 'error',
    });
    return { embedded: 0, full: false };
  }
}

/**
 * Retention for the knowledge index, called from the intelligence retention sweep (which runs even while
 * intelligence is off). Incident-linked chunks follow the fingerprint retention. While the knowledge index is
 * switched off, every derived chunk is removed in bounded batches; human-approved facts stay until removed.
 */
export async function purgeExpiredKnowledge(
  tx: Tx,
  options: { cutoff: Date; limit: number }
): Promise<number> {
  const settings = await getSquireMemorySettings(tx);
  const kinds = settings.knowledgeEnabled ? INCIDENT_KNOWLEDGE_KINDS : DERIVED_KNOWLEDGE_KINDS;
  const rows = await tx.knowledgeChunk.findMany({
    where: {
      sourceKind: { in: [...kinds] },
      ...(settings.knowledgeEnabled ? { sourceCreatedAt: { lt: options.cutoff } } : {}),
    },
    take: options.limit,
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const deleted = await tx.knowledgeChunk.deleteMany({
    where: { id: { in: rows.map(row => row.id) } },
  });
  return deleted.count;
}

/** Proactive notes are derived, incident-linked findings and age out with finding retention. */
export async function purgeExpiredProactiveNotes(
  tx: Tx,
  options: { cutoff: Date; limit: number }
): Promise<number> {
  const rows = await tx.squireProactiveNote.findMany({
    where: { createdAt: { lt: options.cutoff } },
    take: options.limit,
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  return (await tx.squireProactiveNote.deleteMany({ where: { id: { in: rows.map(r => r.id) } } }))
    .count;
}

export const KNOWLEDGE_SUBJECT = 'knowledge';
