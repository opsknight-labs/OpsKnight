import 'server-only';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  getIntelligenceSettings,
  resolveEffectivePolicy,
  withIntelligenceReadMemo,
} from '../settings/service';
import { candidatePolicyModeSql } from '../settings/mode-sql';
import { withDbBudget } from '../jobs/db-budget';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import { registerAiGateway } from '../ai/gateway';
import { BACKGROUND_EMBEDDING_ACTOR } from '../ai/contract';
import { resolveEmbeddingModel, type EmbeddingPort } from '../ai/port';
import { templateHash } from '../jobs/indexer';
import { ensureAnnIndex } from './search';
import { MIN_DIMENSIONS, normalizeVector } from './vector';

/** Rate-limit and audit identity for background embedding; it is never a person. */
export const EMBEDDING_ACTOR = BACKGROUND_EMBEDDING_ACTOR;
/** Values sent per provider call. */
export const EMBED_BATCH_SIZE = 32;
/** How often the lane checks for incidents still to embed. */
export const EMBED_INTERVAL_MS = 60_000;
const EMBED_LOOKBACK_DAYS = 30;

export type EmbedOutcome =
  { status: 'disabled' } | { status: 'done'; model: string; embedded: string[] };

/** The same hash the indexer stores on the fingerprint, so pending work is an indexed comparison. */
const sourceHash = templateHash;

/** The configured embedding model, or null when semantic search is off or unavailable. */
export async function currentEmbeddingModel(): Promise<string | null> {
  return (await currentEmbeddingPort())?.model ?? null;
}

async function currentEmbeddingPort(): Promise<EmbeddingPort | null> {
  if (!(await withIntelligenceReadMemo(() => getIntelligenceSettings())).enabled) return null;
  registerAiGateway();
  return resolveEmbeddingModel('PERSONAL');
}

/**
 * Embeds the masked titles of the given incidents. Only the fingerprint template is sent: it is the
 * title with identifiers and numbers masked. Names and other personal text may remain, so providers
 * must be permitted to receive PERSONAL data; masking never lowers that requirement. Incidents whose text, service and model are unchanged
 * are skipped, so re-indexing (for example on resolve) costs nothing.
 */
export async function embedIncidents(
  incidentIds: readonly string[],
  signal?: AbortSignal
): Promise<EmbedOutcome> {
  if (signal?.aborted || !(await withIntelligenceReadMemo(() => getIntelligenceSettings())).enabled)
    return { status: 'disabled' };
  registerAiGateway();
  const port = await resolveEmbeddingModel('PERSONAL');
  if (!port) return { status: 'disabled' };

  const ids = [...new Set(incidentIds)].slice(0, EMBED_BATCH_SIZE);
  const subjects = await prisma.incident.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      serviceId: true,
      updatedAt: true,
      intelligenceFingerprint: { select: { sourceUpdatedAt: true } },
    },
  });
  const activeServices = await enabledServices(subjects.map(subject => subject.serviceId));
  const activeSubjects = subjects.filter(subject => activeServices.has(subject.serviceId));
  const stale = activeSubjects.filter(
    subject =>
      subject.intelligenceFingerprint?.sourceUpdatedAt?.getTime() !== subject.updatedAt.getTime()
  );
  if (stale.length)
    await enqueueWorkItems(
      stale.map(subject => ({ kind: WORK_KINDS.INDEX_INCIDENT, subjectKey: subject.id }))
    );
  const eligibleIds = activeSubjects
    .filter(
      subject =>
        subject.intelligenceFingerprint?.sourceUpdatedAt?.getTime() === subject.updatedAt.getTime()
    )
    .map(subject => subject.id);
  if (!eligibleIds.length) return { status: 'done', model: port.model, embedded: [] };
  const [fingerprints, existing] = await Promise.all([
    prisma.incidentFingerprint.findMany({
      where: {
        incidentId: { in: eligibleIds },
        incident: { serviceId: { in: [...activeServices] } },
      },
      select: {
        incidentId: true,
        serviceId: true,
        template: true,
        sourceUpdatedAt: true,
        incidentCreatedAt: true,
        incident: { select: { serviceId: true } },
      },
    }),
    prisma.incidentEmbedding.findMany({
      where: {
        incidentId: { in: eligibleIds },
        incident: { serviceId: { in: [...activeServices] } },
      },
      select: { incidentId: true, model: true, sourceHash: true, serviceId: true },
    }),
  ]);
  const current = new Set(
    existing.map(row => `${row.incidentId}|${row.model}|${row.sourceHash}|${row.serviceId}`)
  );
  const pending = fingerprints
    .map(fingerprint => ({
      ...fingerprint,
      serviceId: fingerprint.incident.serviceId,
      text: fingerprint.template,
      hash: sourceHash(fingerprint.template),
    }))
    .filter(
      item =>
        item.text.length > 0 &&
        !current.has(`${item.incidentId}|${port.model}|${item.hash}|${item.serviceId}`)
    );
  if (pending.length === 0) return { status: 'done', model: port.model, embedded: [] };

  const { vectors } = await port.embed(
    pending.map(item => item.text),
    { actorId: EMBEDDING_ACTOR, signal }
  );
  if (vectors.length !== pending.length)
    throw new Error('Embedding provider returned the wrong number of vectors');

  const latestSubjects = await prisma.incident.findMany({
    where: { id: { in: pending.map(item => item.incidentId) } },
    select: {
      id: true,
      serviceId: true,
      updatedAt: true,
      intelligenceFingerprint: { select: { sourceUpdatedAt: true } },
    },
  });
  const latestServices = await enabledServices(latestSubjects.map(subject => subject.serviceId));
  const latestById = new Map(latestSubjects.map(subject => [subject.id, subject]));
  const currentPort = await resolveEmbeddingModel('PERSONAL');
  if (
    signal?.aborted ||
    !currentPort ||
    currentPort.model !== port.model ||
    currentPort.providerId !== port.providerId
  )
    return { status: 'done', model: port.model, embedded: [] };
  const embedded: string[] = [];
  const dimensions = new Set<number>();
  for (const [index, item] of pending.entries()) {
    const latest = latestById.get(item.incidentId);
    if (
      !latest ||
      latest.serviceId !== item.serviceId ||
      latest.updatedAt.getTime() !== item.sourceUpdatedAt?.getTime() ||
      !latestServices.has(item.serviceId)
    )
      continue;
    const vector = normalizeVector(vectors.at(index) ?? []);
    if (vector) dimensions.add(vector.length);
    try {
      if (vector) {
        const data = {
          serviceId: item.serviceId,
          model: port.model,
          sourceHash: item.hash,
          dims: vector.length,
          vector,
          incidentCreatedAt: item.incidentCreatedAt,
          createdAt: new Date(),
        };
        await prisma.incidentEmbedding.upsert({
          where: { incidentId: item.incidentId },
          create: { incidentId: item.incidentId, ...data },
          update: data,
        });
        embedded.push(item.incidentId);
      } else {
        // An unusable vector is recorded without one (never searched), so this text is not retried on
        // every pass and cannot hold up newer incidents behind it.
        await prisma.$executeRaw`
          INSERT INTO "IncidentEmbedding"
            ("incidentId", "serviceId", "model", "sourceHash", "dims", "vector", "incidentCreatedAt", "createdAt")
          VALUES (${item.incidentId}, ${item.serviceId}, ${port.model}, ${item.hash}, ${MIN_DIMENSIONS}, NULL,
                  ${item.incidentCreatedAt}, now())
          ON CONFLICT ("incidentId") DO UPDATE SET
            "serviceId" = EXCLUDED."serviceId", "model" = EXCLUDED."model", "sourceHash" = EXCLUDED."sourceHash",
            "dims" = EXCLUDED."dims", "vector" = NULL, "createdAt" = now()`;
      }
    } catch (error) {
      // The incident was deleted while we were embedding it: nothing to keep.
      const code = (error as { code?: string; meta?: { code?: string } }).code;
      if (code !== 'P2003' && !(code === 'P2010' && /foreign key/i.test(String(error))))
        throw error;
    }
  }
  // Background and best effort: with pgvector this builds the nearest-neighbour index once per size.
  for (const dims of dimensions) void ensureAnnIndex(dims);
  return { status: 'done', model: port.model, embedded };
}

/**
 * Recent incidents whose vector is missing or out of date: new incidents, an edited title, a changed
 * model, or work that failed while a provider was down. Newest first and bounded per pass.
 */
export async function findIncidentsToEmbed(
  model: string,
  now: Date = new Date()
): Promise<string[]> {
  const lowerBound = new Date(now.getTime() - EMBED_LOOKBACK_DAYS * 86_400_000);
  const activeMode = candidatePolicyModeSql(Prisma.sql`s.id`);
  const rows = await withDbBudget(
    { maxDbMs: 750 },
    tx => tx.$queryRaw<Array<{ incidentId: string }>>`
    WITH active_services AS MATERIALIZED (
      SELECT s.id FROM "Service" s WHERE ${activeMode} <> 'OFF'::"IntelligenceMode"
    )
    SELECT f."incidentId" FROM "IncidentFingerprint" f
    JOIN "Incident" i ON i.id = f."incidentId"
    JOIN active_services active ON active.id = i."serviceId"
    LEFT JOIN "IncidentEmbedding" e ON e."incidentId" = f."incidentId"
    WHERE f."incidentCreatedAt" > ${lowerBound} AND length(f."template") > 0
      AND f."templateHash" IS NOT NULL
      AND (e."incidentId" IS NULL OR e."model" <> ${model} OR e."sourceHash" <> f."templateHash" OR e."serviceId" <> i."serviceId" OR f."sourceUpdatedAt" IS DISTINCT FROM i."updatedAt")
    ORDER BY f."incidentCreatedAt" DESC
    LIMIT ${EMBED_BATCH_SIZE}`
  );
  return rows.map(row => row.incidentId);
}

export interface SemanticIndexStatus {
  /** The model in use, or null when semantic search is off or no provider can embed. */
  model: string | null;
  modelLabel?: string;
  /** Incidents with a vector for the current model. */
  indexed: number;
  /** Recent incidents still waiting for a vector (capped for cheap counting). */
  pending: number;
}

const PENDING_COUNT_CAP = 1000;

/** For the settings page: cheap, bounded counts. */
export async function getSemanticIndexStatus(now: Date = new Date()): Promise<SemanticIndexStatus> {
  const port = await currentEmbeddingPort();
  const model = port?.model;
  if (!model) return { model: null, indexed: 0, pending: 0 };
  const lowerBound = new Date(now.getTime() - EMBED_LOOKBACK_DAYS * 86_400_000);
  const activeMode = candidatePolicyModeSql(Prisma.sql`s.id`);
  return withDbBudget({ maxDbMs: 750 }, async tx => {
    const [indexed, pending] = await Promise.all([
      tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "IncidentEmbedding" WHERE "model" = ${model} AND "vector" IS NOT NULL`.then(
        rows => Number(rows[0]?.count ?? 0)
      ),
      tx.$queryRaw<Array<{ count: bigint }>>`
      WITH active_services AS MATERIALIZED (SELECT s.id FROM "Service" s WHERE ${activeMode} <> 'OFF'::"IntelligenceMode")
      SELECT count(*) AS count FROM (
        SELECT 1 FROM "IncidentFingerprint" f
        JOIN "Incident" i ON i.id = f."incidentId"
        JOIN active_services active ON active.id = i."serviceId"
        LEFT JOIN "IncidentEmbedding" e ON e."incidentId" = f."incidentId" AND e."model" = ${model}
        WHERE f."incidentCreatedAt" > ${lowerBound} AND length(f."template") > 0 AND (e."incidentId" IS NULL OR e."sourceHash" <> f."templateHash" OR e."serviceId" <> i."serviceId" OR f."sourceUpdatedAt" IS DISTINCT FROM i."updatedAt")
        LIMIT ${PENDING_COUNT_CAP}) pending`,
    ]);
    return {
      model,
      modelLabel: port?.displayModel ?? model,
      indexed,
      pending: Number(pending[0]?.count ?? 0),
    };
  });
}

/** A fresh policy snapshot for each checkpoint, even inside a memoized worker cycle. */
async function enabledServices(serviceIds: readonly string[]): Promise<Set<string>> {
  return withIntelligenceReadMemo(async () => {
    const ids = [...new Set(serviceIds)];
    const policies = await Promise.all(ids.map(id => resolveEffectivePolicy(id)));
    return new Set(
      ids.filter((_, index) => {
        const mode = policies.at(index)?.effectiveMode;
        return mode === 'SHADOW' || mode === 'SUGGEST' || mode === 'AUTO';
      })
    );
  });
}
