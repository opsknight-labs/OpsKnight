import 'server-only';
import { z } from 'zod/v4';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';
import { withDbBudget } from '../jobs/db-budget';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import {
  getIntelligenceSettings,
  parseOrThrow,
  type IntelligenceActor,
  type IntelligenceSettingsView,
} from '../settings/service';
import { applyCatalogImport, MAX_IMPORT_BYTES, parseCatalog, type ImportSummary } from './import';

/** Sources are checked for being due this often; each source has its own interval. */
export const TOPOLOGY_SYNC_CHECK_INTERVAL_MS = 5 * 60_000;
export const MAX_TOPOLOGY_SOURCES = 20;
const FETCH_TIMEOUT_MS = 15_000;

const urlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(value => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an https URL');

export const topologySourceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: urlSchema,
    intervalMinutes: z
      .number()
      .int()
      .min(15)
      .max(24 * 60)
      .default(60),
    enabled: z.boolean().default(true),
  })
  .strict();

export interface TopologySourceView {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  intervalMinutes: number;
  lastSyncedAt: Date | null;
  lastStatus: string | null;
  lastSummary: ImportSummary | null;
}

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

export async function listTopologySources(
  client: typeof prisma = prisma
): Promise<TopologySourceView[]> {
  const rows = await client.topologySource.findMany({
    orderBy: { name: 'asc' },
    take: MAX_TOPOLOGY_SOURCES,
  });
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    lastSyncedAt: row.lastSyncedAt,
    lastStatus: row.lastStatus,
    lastSummary: (row.lastSummary as ImportSummary | null) ?? null,
  }));
}

/** Caller must authorize INTELLIGENCE_MANAGE. The URL is checked against private networks before it is stored. */
export async function createTopologySource(input: unknown, actor: IntelligenceActor) {
  const parsed = parseOrThrow(topologySourceInputSchema, input);
  try {
    await assertSafeOutboundUrl(parsed.url, { requireHttps: true });
  } catch (error) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [
        {
          field: 'url',
          code: 'custom',
          message: error instanceof Error ? error.message : 'Unsafe URL',
        },
      ],
    });
  }
  return prisma.$transaction(async tx => {
    if ((await tx.topologySource.count()) >= MAX_TOPOLOGY_SOURCES)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'name', code: 'custom', message: 'Source limit reached' }],
      });
    const row = await tx.topologySource.create({
      data: { ...parsed, createdById: actor.actorId },
      select: { id: true },
    });
    await logAudit(
      {
        action: 'intelligence.topology.source.created',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        newValue: { name: parsed.name, url: parsed.url, intervalMinutes: parsed.intervalMinutes },
      },
      tx
    );
    return row;
  });
}

export async function removeTopologySource(
  id: string,
  actor: IntelligenceActor
): Promise<'removed' | 'not_found'> {
  return prisma.$transaction(async tx => {
    const row = await tx.topologySource.findUnique({
      where: { id },
      select: { name: true, url: true },
    });
    if (!row) return 'not_found';
    await tx.topologySource.delete({ where: { id } });
    await logAudit(
      {
        action: 'intelligence.topology.source.removed',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: row,
      },
      tx
    );
    return 'removed';
  });
}

/** Operator action: pull a source now, through the lane, so the request itself fetches nothing. */
export async function requestTopologySync(id: string): Promise<boolean> {
  const row = await prisma.topologySource.findUnique({ where: { id }, select: { id: true } });
  if (!row) return false;
  await enqueueWorkItems([{ kind: WORK_KINDS.SYNC_TOPOLOGY, subjectKey: row.id }]);
  return true;
}

/** Enqueues one SYNC_TOPOLOGY item per enabled source whose interval has elapsed. */
export async function scheduleTopologySyncsIfDue(now: Date = new Date()): Promise<number> {
  if (!(await getIntelligenceSettings()).enabled) return 0;
  const sources = await prisma.topologySource.findMany({
    where: { enabled: true },
    take: MAX_TOPOLOGY_SOURCES,
    select: { id: true, intervalMinutes: true, lastSyncedAt: true },
  });
  const due = sources.filter(
    source =>
      !source.lastSyncedAt ||
      now.getTime() - source.lastSyncedAt.getTime() >= source.intervalMinutes * 60_000
  );
  if (due.length === 0) return 0;
  return enqueueWorkItems(
    due.map(source => ({ kind: WORK_KINDS.SYNC_TOPOLOGY, subjectKey: source.id }))
  );
}

/**
 * Fetches one source over the SSRF-guarded client (bounded size and time), parses it, and declares its
 * edges in one budgeted transaction. Failures are recorded on the source and never thrown past the lane:
 * a broken catalog URL is an operator's problem to see in Settings, not work to retry eight times.
 */
export async function syncTopologySource(
  id: string,
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  signal?: AbortSignal
): Promise<ImportSummary | null> {
  const source = await prisma.topologySource.findUnique({ where: { id } });
  if (!source || !source.enabled) return null;
  const started = new Date();
  const fail = async (status: string) => {
    await prisma.topologySource.update({
      where: { id },
      data: { lastSyncedAt: started, lastStatus: status },
    });
    logger.warn('[Intelligence] Topology source sync failed', { sourceId: id, status });
    return null;
  };
  let text: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await safeOutboundFetch(source.url, {
        method: 'GET',
        headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain' },
        signal: controller.signal,
      });
      if (!response.ok) return fail(`HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_IMPORT_BYTES) return fail('Catalog is larger than 2 MB');
      text = await response.text();
      if (text.length > MAX_IMPORT_BYTES) return fail('Catalog is larger than 2 MB');
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return fail(
      error instanceof Error && error.name === 'AbortError' ? 'Timed out' : 'Fetch failed'
    );
  }
  let summary: ImportSummary;
  try {
    const entities = parseCatalog(text);
    summary = await withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 5000) }, tx =>
      applyCatalogImport(tx, entities, null, `source:${source.name}`)
    );
  } catch (error) {
    return fail(
      error instanceof AppError
        ? (error.fields?.[0]?.message ?? error.userMessage)
        : 'Import failed'
    );
  }
  await prisma.topologySource.update({
    where: { id },
    data: {
      lastSyncedAt: started,
      lastStatus: 'OK',
      lastSummary: { ...summary } as Prisma.InputJsonObject,
    },
  });
  return summary;
}
