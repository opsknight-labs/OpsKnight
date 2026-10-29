import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

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
} as const;
export type WorkKind = (typeof WORK_KINDS)[keyof typeof WORK_KINDS];

/** Lower number = served first. Indexing precedes analysis; both outrank derived/optional work. */
export const WORK_PRIORITY: Record<WorkKind, number> = {
  INDEX_INCIDENT: 10,
  ANALYZE_INCIDENT: 20,
  CORRELATE_INCIDENT: 25,
  ANALYZE_RESPONSE: 30,
  EMBED_PENDING: 40,
  SEND_DIGEST: 50,
};

export const MAX_WORK_ATTEMPTS = 8;
export const DEFAULT_LEASE_MS = 60_000;
const MAX_ERROR_LENGTH = 1000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 15 * 60_000;
/** A dead letter signalled again after this long gets a fresh set of attempts (the outage is likely over). */
export const DEAD_LETTER_REVIVE_MS = 30 * 60_000;
const ENQUEUE_CHUNK = 1_000;

export interface WorkItemInput {
  kind: WorkKind;
  subjectKey: string;
  priority?: number;
  /** Defaults to now; an earlier existing schedule is kept. */
  scheduledAt?: Date;
}

export interface ClaimedWorkItem {
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
 * that failed during an outage resumes on its own while a genuinely poisoned item costs at most one round of
 * attempts per interval.
 */
export async function enqueueWorkItems(
  items: WorkItemInput[],
  client: Client = prisma
): Promise<number> {
  if (items.length === 0) return 0;
  // One row per (kind, subject): ON CONFLICT cannot touch the same row twice in a single statement.
  const unique = new Map<string, WorkItemInput>();
  for (const item of items) unique.set(`${item.kind}\u0000${item.subjectKey}`, item);
  const now = new Date();
  const revive = Prisma.sql`"IntelligenceWorkItem"."attempts" >= ${MAX_WORK_ATTEMPTS}
        AND "IntelligenceWorkItem"."failedAt" < now() - (${DEAD_LETTER_REVIVE_MS} * interval '1 millisecond')`;
  const values = [...unique.values()];
  let written = 0;
  // Chunked: PostgreSQL allows at most 32,767 bind parameters per statement, and each row uses four.
  for (let start = 0; start < values.length; start += ENQUEUE_CHUNK) {
    const rows = values
      .slice(start, start + ENQUEUE_CHUNK)
      .map(
        item =>
          Prisma.sql`(gen_random_uuid()::text, ${item.kind}, ${item.subjectKey}, ${item.priority ?? WORK_PRIORITY[item.kind]}, ${item.scheduledAt ?? now}, nextval('"IntelligenceWorkItem_generation_seq"')::int, now())`
      );
    written += await client.$executeRaw(Prisma.sql`
      INSERT INTO "IntelligenceWorkItem" ("id", "kind", "subjectKey", "priority", "scheduledAt", "generation", "updatedAt")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("kind", "subjectKey") DO UPDATE SET
        "generation" = EXCLUDED."generation",
        "priority" = LEAST("IntelligenceWorkItem"."priority", EXCLUDED."priority"),
        "scheduledAt" = LEAST("IntelligenceWorkItem"."scheduledAt", EXCLUDED."scheduledAt"),
        "attempts" = CASE WHEN ${revive} THEN 0 ELSE "IntelligenceWorkItem"."attempts" END,
        "failedAt" = CASE WHEN ${revive} THEN NULL ELSE "IntelligenceWorkItem"."failedAt" END,
        "updatedAt" = now()
    `);
  }
  return written;
}

/**
 * Atomically leases up to `limit` ready items, highest priority first. Unleased work and expired leases
 * are read as two separate index-backed arms, so neither dead letters nor live leases are ever scanned.
 */
export async function claimWorkItems(
  options: { limit: number; leaseMs?: number; maxAttempts?: number },
  client: Client = prisma
): Promise<ClaimedWorkItem[]> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const maxAttempts = options.maxAttempts ?? MAX_WORK_ATTEMPTS;
  return client.$queryRaw<ClaimedWorkItem[]>(Prisma.sql`
    WITH unleased AS (
      SELECT "id", "priority", "scheduledAt" FROM "IntelligenceWorkItem"
      WHERE "claimToken" IS NULL AND "attempts" < ${maxAttempts} AND "scheduledAt" <= now()
      ORDER BY "priority" ASC, "scheduledAt" ASC, "id" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    ),
    expired AS (
      SELECT "id", "priority", "scheduledAt" FROM "IntelligenceWorkItem"
      WHERE "claimToken" IS NOT NULL AND "leaseUntil" < now() AND "attempts" < ${maxAttempts}
        AND "scheduledAt" <= now()
      ORDER BY "leaseUntil" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    ),
    ready AS (
      SELECT "id" FROM (SELECT * FROM unleased UNION ALL SELECT * FROM expired) candidates
      ORDER BY "priority" ASC, "scheduledAt" ASC, "id" ASC
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
    RETURNING w."id", w."kind", w."subjectKey", w."generation", w."claimToken", w."attempts"
  `);
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
 * for an immediate extra pass (attempts reset: the work itself succeeded). Returns what happened.
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
        "scheduledAt" = now(), "lastError" = NULL, "updatedAt" = now()
    WHERE "id" = ${item.id} AND "claimToken" = ${item.claimToken}
  `);
  return released === 1 ? 'requeued' : 'lost';
}

/**
 * Releases the claim with a backoff. Items reaching the attempt ceiling become dead letters. `minDelayMs`
 * keeps an item from being re-claimed while work it abandoned may still hold a database transaction.
 */
export async function failWorkItem(
  item: Pick<ClaimedWorkItem, 'id' | 'claimToken' | 'attempts'>,
  error: unknown,
  client: Client = prisma,
  random: () => number = Math.random,
  minDelayMs = 0
): Promise<boolean> {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_LENGTH
  );
  const delayMs = Math.max(minDelayMs, computeRetryDelayMs(item.attempts, random));
  const updated = await client.$executeRaw(Prisma.sql`
    UPDATE "IntelligenceWorkItem"
    SET "claimToken" = NULL, "claimedAt" = NULL, "leaseUntil" = NULL, "lastError" = ${message},
        "scheduledAt" = now() + (${delayMs} * interval '1 millisecond'),
        "failedAt" = CASE WHEN "attempts" >= ${MAX_WORK_ATTEMPTS} THEN now() ELSE NULL END,
        "updatedAt" = now()
    WHERE "id" = ${item.id} AND "claimToken" = ${item.claimToken}
  `);
  return updated === 1;
}

export interface WorkBacklog {
  ready: number;
  leased: number;
  deadLetters: number;
  oldestReadyAgeMs: number | null;
}

export async function getWorkBacklog(
  maxAttempts: number = MAX_WORK_ATTEMPTS,
  client: Client = prisma
): Promise<WorkBacklog> {
  const [row] = await client.$queryRaw<
    Array<{ ready: bigint; leased: bigint; dead: bigint; oldest_ms: number | null }>
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE "attempts" < ${maxAttempts} AND "scheduledAt" <= now()
        AND ("claimToken" IS NULL OR "leaseUntil" < now())) AS ready,
      count(*) FILTER (WHERE "claimToken" IS NOT NULL AND "leaseUntil" >= now()) AS leased,
      count(*) FILTER (WHERE "attempts" >= ${maxAttempts}) AS dead,
      (EXTRACT(EPOCH FROM (now() - min("scheduledAt") FILTER (WHERE "attempts" < ${maxAttempts}
        AND "scheduledAt" <= now() AND ("claimToken" IS NULL OR "leaseUntil" < now())))) * 1000)::float8 AS oldest_ms
    FROM "IntelligenceWorkItem"
  `);
  return {
    ready: Number(row?.ready ?? 0),
    leased: Number(row?.leased ?? 0),
    deadLetters: Number(row?.dead ?? 0),
    oldestReadyAgeMs: row?.oldest_ms ?? null,
  };
}

export async function listDeadLetters(
  options: { limit?: number; maxAttempts?: number } = {},
  client: Client = prisma
) {
  return client.intelligenceWorkItem.findMany({
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
    },
  });
}

/** Operator action: gives a dead letter a fresh set of attempts. */
export async function replayDeadLetter(
  id: string,
  options: { maxAttempts?: number } = {},
  client: Client = prisma
): Promise<boolean> {
  const replayed = await client.intelligenceWorkItem.updateMany({
    where: { id, attempts: { gte: options.maxAttempts ?? MAX_WORK_ATTEMPTS } },
    data: {
      attempts: 0,
      scheduledAt: new Date(),
      claimToken: null,
      leaseUntil: null,
      lastError: null,
      failedAt: null,
    },
  });
  return replayed.count === 1;
}

/** Retention: dead letters nobody replayed are dropped after `olderThanMs`; the data is all rebuildable. */
export async function purgeDeadLetters(
  olderThanMs: number,
  limit: number,
  client: Client = prisma
): Promise<number> {
  return client.$executeRaw(Prisma.sql`
    DELETE FROM "IntelligenceWorkItem" WHERE "id" IN (
      SELECT "id" FROM "IntelligenceWorkItem"
      WHERE "attempts" >= ${MAX_WORK_ATTEMPTS} AND "failedAt" < now() - (${olderThanMs} * interval '1 millisecond')
      LIMIT ${limit})
  `);
}
