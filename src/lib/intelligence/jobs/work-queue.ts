import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { encodeWorkFailure, describeWorkFailure } from './failures';

/**
 * Coalesced, durable work queue for the intelligence lane.
 *
 * An alert storm must produce one unit of work per (kind, subject), not one per alert, so enqueueing
 * is an idempotent upsert that only bumps a generation counter. Claiming uses FOR UPDATE SKIP LOCKED
 * with leases, so any number of workers can run safely, and a crashed worker's items are re-claimed
 * when the lease expires. Completion is compare-and-delete on the generation: if new signals arrived
 * while an item was running, it is released for another pass instead of being lost.
 *
 * Generations come from one database sequence, so they only ever increase, even after a finished item
 * is deleted and the same subject is signalled again. Findings are fenced on the generation that
 * produced them, which therefore always orders analyses correctly.
 */

type Client = Prisma.TransactionClient | typeof prisma;

export const WORK_KINDS = {
  INDEX_INCIDENT: 'INDEX_INCIDENT',
  ANALYZE_INCIDENT: 'ANALYZE_INCIDENT',
  CORRELATE_INCIDENT: 'CORRELATE_INCIDENT',
  ANALYZE_RESPONSE: 'ANALYZE_RESPONSE',
  /** One coalesced item: embeds a bounded batch of pending incidents per provider call. */
  EMBED_PENDING: 'EMBED_PENDING',
  /** One item per ISO week (subject = week key), sending the digest in chunks. */
  SEND_DIGEST: 'SEND_DIGEST',
  OBSERVE_DEPENDENCIES: 'OBSERVE_DEPENDENCIES',
  /** One item per late-arriving change event (subject = change id): re-analyses incidents it may explain. */
  LATE_CHANGE: 'LATE_CHANGE',
  /** Triage suggestions for one incident, chained after its similar-incident analysis. */
  TRIAGE_INCIDENT: 'TRIAGE_INCIDENT',
  /** Pulls one declared-topology source (subject = source id). */
  SYNC_TOPOLOGY: 'SYNC_TOPOLOGY',
  // Squire knowledge memory and proactive notes (F4); see memory/handlers.ts. All opt-in.
  /** One coalesced item: a bounded keyset pass that keeps the knowledge index in sync with its sources. */
  SYNC_KNOWLEDGE: 'SYNC_KNOWLEDGE',
  /** One coalesced item: finds incidents on opted-in services that need a briefing, nudge or draft. */
  SQUIRE_PROACTIVE_SCAN: 'SQUIRE_PROACTIVE_SCAN',
  /** One item per (kind, incident), subject `KIND:incidentId`: writes one proactive note. */
  SQUIRE_PROACTIVE: 'SQUIRE_PROACTIVE',
} as const;
export type WorkKind = (typeof WORK_KINDS)[keyof typeof WORK_KINDS];

/** Lower number = served first. New insight outranks indexing a backlog; aging prevents starvation. */
export const WORK_PRIORITY: Record<WorkKind, number> = {
  INDEX_INCIDENT: 10,
  ANALYZE_INCIDENT: 5,
  CORRELATE_INCIDENT: 25,
  ANALYZE_RESPONSE: 30,
  LATE_CHANGE: 35,
  TRIAGE_INCIDENT: 28,
  EMBED_PENDING: 40,
  SEND_DIGEST: 50,
  OBSERVE_DEPENDENCIES: 45,
  SYNC_TOPOLOGY: 48,
  // Squire memory (F4): proactive notes follow first analysis; the index is background maintenance.
  SQUIRE_PROACTIVE: 32,
  SQUIRE_PROACTIVE_SCAN: 33,
  SYNC_KNOWLEDGE: 55,
};

export const MAX_WORK_ATTEMPTS = 8;
export const DEFAULT_LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 15 * 60_000;
/** A dead letter signalled again after this long gets a fresh set of attempts (the outage is likely over). */
export const DEAD_LETTER_REVIVE_MS = 30 * 60_000;
/**
 * Work that dies a second time within this window is poisoned, not unlucky: it is quarantined, never revived
 * on its own, and waits for an operator replay. A transient outage can only ever cost one extra round.
 */
export const QUARANTINE_WINDOW_MS = 24 * 60 * 60_000;
const ENQUEUE_CHUNK = 1_000;
export const PRIORITY_AGE_BUCKET_MS = 30_000;
/** Fresh ingestion must get indexed before a newly queued historical repair batch. */
export const FIRST_INSIGHT_INDEX_PRIORITY = 0;

export interface WorkItemInput {
  force?: boolean;
  kind: WorkKind;
  subjectKey: string;
  priority?: number;
  /** Defaults to now; an earlier existing schedule is kept. */
  scheduledAt?: Date;
}

export interface ClaimedWorkItem {
  force?: boolean;
  id: string;
  kind: string;
  subjectKey: string;
  generation: number;
  claimToken: string;
  attempts: number;
}

/** Exponential backoff with full jitter, capped so a poisoned item cannot spin the database. */
export function computeRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 20);
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.floor(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * Upserts a batch in one statement. Re-signalling an existing item only takes a newer generation. A dead
 * letter that has been dead for longer than the revive interval is given a fresh set of attempts, so work
 * that failed during an outage resumes on its own. `failedAt` is kept through a revival: it records when the
 * item last died, and a second death inside the quarantine window marks the item poisoned. Quarantined items
 * are never revived here.
 */
export async function enqueueWorkItems(
  items: WorkItemInput[],
  client: Client = prisma
): Promise<number> {
  if (items.length === 0) return 0;
  // One row per (kind, subject): ON CONFLICT cannot touch the same row twice in a single statement.
  const unique = new Map<string, WorkItemInput>();
  for (const item of items) {
    const key = `${item.kind}\u0000${item.subjectKey}`;
    const previous = unique.get(key);
    unique.set(
      key,
      previous
        ? {
            ...item,
            force: Boolean(previous.force || item.force),
            priority: Math.min(
              previous.priority ?? WORK_PRIORITY[item.kind],
              item.priority ?? WORK_PRIORITY[item.kind]
            ),
            scheduledAt:
              previous.scheduledAt && item.scheduledAt
                ? new Date(Math.min(+previous.scheduledAt, +item.scheduledAt))
                : undefined,
          }
        : item
    );
  }
  const revive = Prisma.sql`"IntelligenceWorkItem"."attempts" >= ${MAX_WORK_ATTEMPTS}
        AND "IntelligenceWorkItem"."quarantinedAt" IS NULL
        AND "IntelligenceWorkItem"."failedAt" < now() - (${DEAD_LETTER_REVIVE_MS} * interval '1 millisecond')`;
  const values = [...unique.values()];
  let written = 0;
  // Chunked: PostgreSQL allows at most 32,767 bind parameters per statement, and each row uses four.
  for (let start = 0; start < values.length; start += ENQUEUE_CHUNK) {
    const rows = values
      .slice(start, start + ENQUEUE_CHUNK)
      .map(
        item =>
          Prisma.sql`(gen_random_uuid()::text, ${item.kind}, ${item.subjectKey}, ${item.priority ?? WORK_PRIORITY[item.kind]}, ${item.scheduledAt ?? Prisma.sql`now()`}, nextval('"IntelligenceWorkItem_generation_seq"')::int, now(), ${item.force ?? false})`
      );
    written += await client.$executeRaw(Prisma.sql`
      INSERT INTO "IntelligenceWorkItem" ("id", "kind", "subjectKey", "priority", "scheduledAt", "generation", "updatedAt", "force")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("kind", "subjectKey") DO UPDATE SET
        "generation" = EXCLUDED."generation",
        "force" = "IntelligenceWorkItem"."force" OR EXCLUDED."force",
        "priority" = LEAST("IntelligenceWorkItem"."priority", EXCLUDED."priority"),
        "scheduledAt" = LEAST("IntelligenceWorkItem"."scheduledAt", EXCLUDED."scheduledAt"),
        "attempts" = CASE WHEN ${revive} THEN 0 ELSE "IntelligenceWorkItem"."attempts" END,
        "updatedAt" = now()
    `);
  }
  return written;
}

/**
 * Atomically leases up to `limit` ready items, highest priority first. Unleased work and expired leases
 * are read as two separate index-backed arms, so neither dead letters nor live leases are ever scanned.
 * `excludeKinds` leaves kinds whose handler is currently tripped (see the kind breaker) in the queue.
 */
export interface ClaimOptions {
  limit: number;
  leaseMs?: number;
  maxAttempts?: number;
  excludeKinds?: readonly string[];
}

export async function claimWorkItems(
  options: ClaimOptions,
  client: Client = prisma
): Promise<ClaimedWorkItem[]> {
  return client.$queryRaw<ClaimedWorkItem[]>(claimWorkItemsSql(options));
}

/** The production claim statement itself, so benchmarks can EXPLAIN exactly what the lane runs. */
export function claimWorkItemsSql(options: ClaimOptions): Prisma.Sql {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const maxAttempts = options.maxAttempts ?? MAX_WORK_ATTEMPTS;
  const excluded = [...(options.excludeKinds ?? [])];
  return Prisma.sql`
    WITH unleased AS (
      SELECT "id", "priority", "scheduledAt", "createdAt" FROM "IntelligenceWorkItem"
      WHERE "claimToken" IS NULL AND "attempts" < ${maxAttempts} AND "scheduledAt" <= now()
        AND NOT ("kind" = ANY(${excluded}::text[]))
      ORDER BY "priority" ASC, "scheduledAt" ASC, "id" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    ),
    aged AS (
      SELECT "id", "priority", "scheduledAt", "createdAt" FROM "IntelligenceWorkItem"
      WHERE "claimToken" IS NULL AND "attempts" < ${maxAttempts} AND "scheduledAt" <= now()
        AND NOT ("kind" = ANY(${excluded}::text[]))
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    ),
    expired AS (
      SELECT "id", "priority", "scheduledAt", "createdAt" FROM "IntelligenceWorkItem"
      WHERE "claimToken" IS NOT NULL AND "leaseUntil" < now() AND "attempts" < ${maxAttempts}
        AND "scheduledAt" <= now() AND NOT ("kind" = ANY(${excluded}::text[]))
      ORDER BY "leaseUntil" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    ),
    ready AS (
      SELECT "id" FROM (SELECT * FROM unleased UNION SELECT * FROM aged UNION SELECT * FROM expired) candidates
      ORDER BY ("priority" - floor(extract(epoch FROM (now() - "createdAt")) * 1000 / ${PRIORITY_AGE_BUCKET_MS})) ASC,
        "scheduledAt" ASC, "id" ASC
      LIMIT ${options.limit}
    )
    UPDATE "IntelligenceWorkItem" AS w SET
      "claimToken" = gen_random_uuid()::text,
      "claimedAt" = now(),
      "leaseUntil" = now() + (${leaseMs} * interval '1 millisecond'),
      "attempts" = w."attempts" + 1,
      "updatedAt" = now()
    FROM ready
    WHERE w."id" = ready."id"
    RETURNING w."id", w."kind", w."subjectKey", w."generation", w."claimToken", w."attempts", w."force"
  `;
}

/** Extends a lease for long-running handlers; false means the claim was lost and work must stop. */
export async function renewWorkItemLease(
  item: Pick<ClaimedWorkItem, 'id' | 'claimToken'>,
  leaseMs: number = DEFAULT_LEASE_MS,
  client: Client = prisma
): Promise<boolean> {
  const renewed = await client.$executeRaw(Prisma.sql`
    UPDATE "IntelligenceWorkItem"
    SET "leaseUntil" = now() + (${leaseMs} * interval '1 millisecond'), "updatedAt" = now()
    WHERE "id" = ${item.id} AND "claimToken" = ${item.claimToken}
  `);
  return renewed === 1;
}

/**
 * Removes the item only if no newer signal arrived while it ran. Otherwise the claim is released
 * for an extra pass (attempts reset: the work itself succeeded). A deliberately future schedule set by
 * the signal that arrived mid-run is kept; otherwise the pass is immediate. Returns what happened.
 */
export async function completeWorkItem(
  item: Pick<ClaimedWorkItem, 'id' | 'claimToken' | 'generation'>,
  client: Client = prisma
): Promise<'completed' | 'requeued' | 'lost'> {
  const deleted = await client.$executeRaw(Prisma.sql`
    DELETE FROM "IntelligenceWorkItem"
    WHERE "id" = ${item.id} AND "claimToken" = ${item.claimToken} AND "generation" = ${item.generation}
  `);
  if (deleted === 1) return 'completed';
  const released = await client.$executeRaw(Prisma.sql`
    UPDATE "IntelligenceWorkItem"
    SET "claimToken" = NULL, "claimedAt" = NULL, "leaseUntil" = NULL, "attempts" = 0,
        "scheduledAt" = GREATEST("scheduledAt", now()), "lastError" = NULL, "updatedAt" = now()
    WHERE "id" = ${item.id} AND "claimToken" = ${item.claimToken}
  `);
  return released === 1 ? 'requeued' : 'lost';
}

/**
 * Releases the claim with a backoff. Items reaching the attempt ceiling become dead letters, and a dead
 * letter that dies again within the quarantine window is quarantined. `minDelayMs` keeps an item from being
 * re-claimed while work it abandoned may still hold a database transaction. SET expressions read the row as it
 * was before this statement, so `"failedAt"` below is the previous death.
 */
export async function failWorkItem(
  item: Pick<ClaimedWorkItem, 'id' | 'claimToken' | 'attempts'>,
  error: unknown,
  client: Client = prisma,
  random: () => number = Math.random,
  minDelayMs = 0
): Promise<boolean> {
  const message = encodeWorkFailure(error);
  const delayMs = Math.max(minDelayMs, computeRetryDelayMs(item.attempts, random));
  const dying = Prisma.sql`"attempts" >= ${MAX_WORK_ATTEMPTS}`;
  const updated = await client.$executeRaw(Prisma.sql`
    UPDATE "IntelligenceWorkItem"
    SET "claimToken" = NULL, "claimedAt" = NULL, "leaseUntil" = NULL, "lastError" = ${message},
        "scheduledAt" = now() + (${delayMs} * interval '1 millisecond'),
        "quarantinedAt" = CASE
          WHEN ${dying} AND "failedAt" IS NOT NULL
            AND "failedAt" > now() - (${QUARANTINE_WINDOW_MS} * interval '1 millisecond')
          THEN COALESCE("quarantinedAt", now())
          ELSE "quarantinedAt" END,
        "failedAt" = CASE WHEN ${dying} THEN now() ELSE "failedAt" END,
        "updatedAt" = now()
    WHERE "id" = ${item.id} AND "claimToken" = ${item.claimToken}
  `);
  return updated === 1;
}

export interface WorkBacklog {
  ready: number;
  leased: number;
  /** Includes quarantined items. */
  deadLetters: number;
  quarantined: number;
  oldestReadyAgeMs: number | null;
}

/** Scrapes reuse one aggregate for this long per process; operator pages and tests read fresh. */
export const WORK_BACKLOG_CACHE_MS = 10_000;
let backlogCache: { at: number; value: Promise<WorkBacklog> } | null = null;

/**
 * Backlog counts for the settings page and metrics. The aggregate reads every row of the work table, which
 * is small in steady state (finished items are deleted) but can hold many dead letters or a long backfill;
 * `maxAgeMs` lets frequent callers such as the metrics scrape share one recent answer per process instead of
 * running the aggregate on every scrape.
 */
export async function getWorkBacklog(
  maxAttempts: number = MAX_WORK_ATTEMPTS,
  client: Client = prisma,
  options: { maxAgeMs?: number; now?: number } = {}
): Promise<WorkBacklog> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 0;
  if (maxAgeMs > 0 && client === prisma && backlogCache && now - backlogCache.at < maxAgeMs)
    return backlogCache.value;
  const value = readWorkBacklog(maxAttempts, client);
  if (maxAgeMs > 0 && client === prisma) {
    backlogCache = { at: now, value };
    value.catch(() => {
      backlogCache = null;
    });
  }
  return value;
}

export function resetWorkBacklogCacheForTests() {
  backlogCache = null;
}

async function readWorkBacklog(maxAttempts: number, client: Client): Promise<WorkBacklog> {
  const [row] = await client.$queryRaw<
    Array<{
      ready: bigint;
      leased: bigint;
      dead: bigint;
      quarantined: bigint;
      oldest_ms: number | null;
    }>
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE "attempts" < ${maxAttempts} AND "scheduledAt" <= now()
        AND ("claimToken" IS NULL OR "leaseUntil" < now())) AS ready,
      count(*) FILTER (WHERE "claimToken" IS NOT NULL AND "leaseUntil" >= now()) AS leased,
      count(*) FILTER (WHERE "attempts" >= ${maxAttempts}) AS dead,
      count(*) FILTER (WHERE "quarantinedAt" IS NOT NULL) AS quarantined,
      (EXTRACT(EPOCH FROM (now() - min("scheduledAt") FILTER (WHERE "attempts" < ${maxAttempts}
        AND "scheduledAt" <= now() AND ("claimToken" IS NULL OR "leaseUntil" < now())))) * 1000)::float8 AS oldest_ms
    FROM "IntelligenceWorkItem"
  `);
  return {
    ready: Number(row?.ready ?? 0),
    leased: Number(row?.leased ?? 0),
    deadLetters: Number(row?.dead ?? 0),
    quarantined: Number(row?.quarantined ?? 0),
    oldestReadyAgeMs: row?.oldest_ms ?? null,
  };
}

export async function listDeadLetters(
  options: { limit?: number; maxAttempts?: number } = {},
  client: Client = prisma
) {
  const rows = await client.intelligenceWorkItem.findMany({
    where: { attempts: { gte: options.maxAttempts ?? MAX_WORK_ATTEMPTS } },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    select: {
      id: true,
      kind: true,
      subjectKey: true,
      attempts: true,
      lastError: true,
      updatedAt: true,
      scheduledAt: true,
      failedAt: true,
      quarantinedAt: true,
    },
  });
  return rows.map(({ lastError, quarantinedAt, ...row }) => ({
    ...row,
    quarantined: quarantinedAt !== null,
    ...describeWorkFailure(lastError),
  }));
}

/** Operator action: gives a dead letter (quarantined or not) a fresh set of attempts. */
export async function replayDeadLetter(
  id: string,
  options: { maxAttempts?: number } = {},
  client: Client = prisma
): Promise<boolean> {
  const replayed = await client.$executeRaw(Prisma.sql`
    UPDATE "IntelligenceWorkItem" SET attempts = 0, "scheduledAt" = now(), "claimToken" = NULL,
      "leaseUntil" = NULL, "lastError" = NULL, "failedAt" = NULL, "quarantinedAt" = NULL, "updatedAt" = now()
    WHERE id = ${id} AND attempts >= ${options.maxAttempts ?? MAX_WORK_ATTEMPTS}`);
  return replayed === 1;
}

/**
 * Retention: dead letters nobody replayed are dropped after `olderThanMs`; the data is all rebuildable.
 * Quarantined items stay until an operator replays them, so a poisoned subject cannot restart its cycle by
 * being purged and signalled again.
 */
export async function purgeDeadLetters(
  olderThanMs: number,
  limit: number,
  client: Client = prisma
): Promise<number> {
  return client.$executeRaw(Prisma.sql`
    DELETE FROM "IntelligenceWorkItem" WHERE "id" IN (
      SELECT "id" FROM "IntelligenceWorkItem"
      WHERE "attempts" >= ${MAX_WORK_ATTEMPTS} AND "quarantinedAt" IS NULL
        AND "failedAt" < now() - (${olderThanMs} * interval '1 millisecond')
      LIMIT ${limit})
  `);
}
