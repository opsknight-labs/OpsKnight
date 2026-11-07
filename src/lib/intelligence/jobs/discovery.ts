import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { dbNow } from './db-budget';
import { enqueueWorkItems, WORK_KINDS, FIRST_INSIGHT_INDEX_PRIORITY } from './work-queue';

const CURSOR_NAME = 'incident-discovery';
const UPDATED_CURSOR_NAME = 'fingerprint-reconcile-updated';

/**
 * Incidents are only discovered once they are older than this, so a transaction that took longer to
 * commit than a later one cannot slip behind the watermark. Ingestion transactions take milliseconds.
 */
export const DISCOVERY_SAFETY_LAG_MS = 30_000;

export interface DiscoveryResult {
  /** False when another worker holds the singleton discovery lock this cycle. */
  ran: boolean;
  discovered: number;
}

/**
 * Finds new incidents by keyset watermark and signals one INDEX_INCIDENT work item for each. This is
 * what keeps intelligence entirely off the ingestion path: nothing is written when an incident is
 * created. The first run starts from "now"; history is indexed only through an explicit backfill.
 * Bounds come from the database clock unless a caller (tests, benchmarks) supplies `now`.
 */
export async function discoverNewIncidents(
  options: { limit: number; now?: Date; lagMs?: number },
  client: typeof prisma = prisma
): Promise<DiscoveryResult> {
  return client.$transaction(async tx => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-incident-discovery', 0)) AS locked`;
    if (!locked) return { ran: false, discovered: 0 };
    const now = options.now ?? (await dbNow(tx));
    const upperBound = new Date(now.getTime() - (options.lagMs ?? DISCOVERY_SAFETY_LAG_MS));

    const cursor = await tx.intelligenceCursor.findUnique({ where: { name: CURSOR_NAME } });
    if (!cursor) {
      await tx.intelligenceCursor.create({
        data: { name: CURSOR_NAME, watermarkAt: upperBound, lastId: '' },
      });
      return { ran: true, discovered: 0 };
    }

    const rows = await tx.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
      SELECT "id", "createdAt" FROM "Incident"
      WHERE ("createdAt" > ${cursor.watermarkAt}
             OR ("createdAt" = ${cursor.watermarkAt} AND "id" > ${cursor.lastId}))
        AND "createdAt" <= ${upperBound}
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT ${options.limit}
    `);
    if (rows.length === 0) return { ran: true, discovered: 0 };

    await enqueueWorkItems(
      rows.map(row => ({
        kind: WORK_KINDS.INDEX_INCIDENT,
        subjectKey: row.id,
        priority: FIRST_INSIGHT_INDEX_PRIORITY,
      })),
      tx
    );
    const last = rows[rows.length - 1];
    await tx.intelligenceCursor.update({
      where: { name: CURSOR_NAME },
      data: { watermarkAt: last.createdAt, lastId: last.id },
    });
    return { ran: true, discovered: rows.length };
  });
}

/** Placeholders (policy OFF) are re-checked this often, so turning a policy on catches up on its own. */
const SUPPRESSED_RECHECK_MS = 60 * 60_000;

export interface RepairCounts {
  missing: number;
  staleResolution: number;
  suppressed: number;
  staleSource: number;
}

const NO_REPAIRS: RepairCounts = { missing: 0, staleResolution: 0, suppressed: 0, staleSource: 0 };

/**
 * Compares incidents with their fingerprints and queues one INDEX_INCIDENT per repair reason, at most
 * `limit` per reason. Shared by both anti-entropy sweeps.
 */
async function queueFingerprintRepairs(
  tx: Prisma.TransactionClient,
  ids: string[],
  now: Date,
  limit: number
): Promise<RepairCounts> {
  if (ids.length === 0) return { ...NO_REPAIRS };
  const recheckBefore = new Date(now.getTime() - SUPPRESSED_RECHECK_MS);
  const candidates = await tx.$queryRaw<Array<{ id: string; reason: string }>>(Prisma.sql`
    SELECT i."id", CASE
      WHEN f."incidentId" IS NULL THEN 'missing'
      WHEN (i."resolvedAt" IS NULL) <> (f."resolvedAt" IS NULL) THEN 'staleResolution'
      WHEN f."template" = '' AND f."updatedAt" < ${recheckBefore} THEN 'suppressed'
      WHEN f."template" <> '' AND (i."updatedAt" IS DISTINCT FROM f."sourceUpdatedAt"
        OR f."engineVersion" <> ${INTELLIGENCE_ENGINE_VERSION} OR f."alertNormalizationHash" IS NULL
        OR f."alertIndexPartial") THEN 'staleSource'
      ELSE NULL END AS reason
    FROM "Incident" i LEFT JOIN "IncidentFingerprint" f ON f."incidentId" = i."id"
    WHERE i."id" IN (${Prisma.join(ids)})
  `);
  const pick = (reason: string) => candidates.filter(row => row.reason === reason).slice(0, limit);
  const missing = pick('missing');
  const staleResolution = pick('staleResolution');
  const staleSource = pick('staleSource');
  const suppressed = pick('suppressed');
  await enqueueWorkItems(
    [...missing, ...staleResolution, ...staleSource, ...suppressed].map(row => ({
      kind: WORK_KINDS.INDEX_INCIDENT,
      subjectKey: row.id,
    })),
    tx
  );
  return {
    missing: missing.length,
    staleResolution: staleResolution.length,
    staleSource: staleSource.length,
    suppressed: suppressed.length,
  };
}

/**
 * Anti-entropy over recent history: repairs anything the watermarks could not see — incidents that never
 * got a fingerprint, placeholders whose policy may have been switched on since, and fingerprints built by an
 * older engine version. Derived data is always rebuildable from the source of truth, so a lost job or a
 * missed row heals on a later sweep. It is paced slowly (see the runner); the updated-incident sweep below
 * is what catches ordinary changes quickly. One replica sweeps at a time; the others skip.
 */
export async function reconcileFingerprints(
  options: { limit: number; lookbackDays: number; now?: Date; lagMs?: number; maxDbMs?: number },
  client: typeof prisma = prisma
): Promise<RepairCounts> {
  const maxDbMs = Math.max(50, Math.min(2000, Math.floor(options.maxDbMs ?? 1000)));
  return client.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(maxDbMs)}, true), set_config('lock_timeout', ${String(Math.min(maxDbMs, 1000))}, true)`;
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-reconcile', 0)) AS locked`;
    if (!locked) return { ...NO_REPAIRS };
    const now = options.now ?? (await dbNow(tx));
    const upperBound = new Date(now.getTime() - (options.lagMs ?? DISCOVERY_SAFETY_LAG_MS));
    const lowerBound = new Date(now.getTime() - options.lookbackDays * 86_400_000);

    // Persist a keyset cursor across passes. A healthy history is visited one bounded page at a time
    // rather than joined in full every pass. Cursor and signals commit together.
    const name = 'fingerprint-reconcile';
    const cursor = await tx.intelligenceCursor.findUnique({ where: { name } });
    const after =
      cursor && cursor.watermarkAt >= lowerBound && cursor.watermarkAt <= upperBound
        ? cursor
        : { watermarkAt: lowerBound, lastId: '' };
    const pageSize = Math.max(100, Math.min(500, options.limit * 10));
    const page = await tx.incident.findMany({
      where: {
        createdAt: { gt: lowerBound, lte: upperBound },
        OR: [
          { createdAt: { gt: after.watermarkAt } },
          { createdAt: after.watermarkAt, id: { gt: after.lastId } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize,
      select: { id: true, createdAt: true },
    });
    const last = page[page.length - 1];
    const next =
      page.length === pageSize && last
        ? { watermarkAt: last.createdAt, lastId: last.id }
        : { watermarkAt: lowerBound, lastId: '' };
    await tx.intelligenceCursor.upsert({
      where: { name },
      create: { name, ...next },
      update: next,
    });
    return queueFingerprintRepairs(
      tx,
      page.map(row => row.id),
      now,
      options.limit
    );
  });
}

/**
 * Lost-signal repair in O(changes): walks incidents by `updatedAt` watermark, so an acknowledgement,
 * resolution or new alert whose wake notification was lost is re-indexed within a cycle or two, whatever
 * the size of the history. Uses the existing `Incident(updatedAt)` index. The first run starts at "now".
 * One replica sweeps at a time; the others skip.
 */
export async function reconcileUpdatedIncidents(
  options: { limit: number; now?: Date; lagMs?: number; maxDbMs?: number },
  client: typeof prisma = prisma
): Promise<RepairCounts & { scanned: number }> {
  const maxDbMs = Math.max(50, Math.min(2000, Math.floor(options.maxDbMs ?? 1000)));
  return client.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(maxDbMs)}, true), set_config('lock_timeout', ${String(Math.min(maxDbMs, 1000))}, true)`;
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-reconcile-updated', 0)) AS locked`;
    if (!locked) return { ...NO_REPAIRS, scanned: 0 };
    const now = options.now ?? (await dbNow(tx));
    const upperBound = new Date(now.getTime() - (options.lagMs ?? DISCOVERY_SAFETY_LAG_MS));
    const cursor = await tx.intelligenceCursor.findUnique({ where: { name: UPDATED_CURSOR_NAME } });
    if (!cursor) {
      await tx.intelligenceCursor.create({
        data: { name: UPDATED_CURSOR_NAME, watermarkAt: upperBound, lastId: '' },
      });
      return { ...NO_REPAIRS, scanned: 0 };
    }
    const pageSize = Math.max(100, Math.min(500, options.limit * 10));
    const page = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(Prisma.sql`
      SELECT "id", "updatedAt" FROM "Incident"
      WHERE ("updatedAt" > ${cursor.watermarkAt}
             OR ("updatedAt" = ${cursor.watermarkAt} AND "id" > ${cursor.lastId}))
        AND "updatedAt" <= ${upperBound}
      ORDER BY "updatedAt" ASC, "id" ASC
      LIMIT ${pageSize}
    `);
    if (page.length === 0) return { ...NO_REPAIRS, scanned: 0 };
    const counts = await queueFingerprintRepairs(
      tx,
      page.map(row => row.id),
      now,
      options.limit
    );
    const last = page[page.length - 1];
    await tx.intelligenceCursor.update({
      where: { name: UPDATED_CURSOR_NAME },
      data: { watermarkAt: last.updatedAt, lastId: last.id },
    });
    return { ...counts, scanned: page.length };
  });
}
