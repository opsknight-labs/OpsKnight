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
 */

type Client = Prisma.TransactionClient | typeof prisma;

export const WORK_KINDS = {
  INDEX_INCIDENT: 'INDEX_INCIDENT',
  ANALYZE_INCIDENT: 'ANALYZE_INCIDENT',
} as const;
export type WorkKind = (typeof WORK_KINDS)[keyof typeof WORK_KINDS];

/** Lower number = served first. Indexing precedes analysis; both outrank derived/optional work. */
export const WORK_PRIORITY: Record<WorkKind, number> = {
  INDEX_INCIDENT: 10,
  ANALYZE_INCIDENT: 20,
};

export const MAX_WORK_ATTEMPTS = 8;
export const DEFAULT_LEASE_MS = 60_000;
const MAX_ERROR_LENGTH = 1000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 15 * 60_000;

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

/** Upserts a batch in one statement. Re-signalling an existing item only bumps its generation. */
export async function enqueueWorkItems(items: WorkItemInput[], client: Client = prisma): Promise<number> {
  if (items.length === 0) return 0;
  // One row per (kind, subject): ON CONFLICT cannot touch the same row twice in a single statement.
  const unique = new Map<string, WorkItemInput>();
  for (const item of items) unique.set(`${item.kind}\u0000${item.subjectKey}`, item);
  const now = new Date();
  const rows = [...unique.values()].map(
    item =>
      Prisma.sql`(gen_random_uuid()::text, ${item.kind}, ${item.subjectKey}, ${item.priority ?? WORK_PRIORITY[item.kind]}, ${item.scheduledAt ?? now}, now())`
  );
  return client.$executeRaw(Prisma.sql`
    INSERT INTO "IntelligenceWorkItem" ("id", "kind", "subjectKey", "priority", "scheduledAt", "updatedAt")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("kind", "subjectKey") DO UPDATE SET
      "generation" = "IntelligenceWorkItem"."generation" + 1,
      "priority" = LEAST("IntelligenceWorkItem"."priority", EXCLUDED."priority"),
      "scheduledAt" = LEAST("IntelligenceWorkItem"."scheduledAt", EXCLUDED."scheduledAt"),
      "updatedAt" = now()
  `);
}

/** Atomically leases up to `limit` ready items, highest priority first. */
export async function claimWorkItems(
  options: { limit: number; leaseMs?: number; maxAttempts?: number },
  client: Client = prisma
): Promise<ClaimedWorkItem[]> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const maxAttempts = options.maxAttempts ?? MAX_WORK_ATTEMPTS;
  return client.$queryRaw<ClaimedWorkItem[]>(Prisma.sql`
    WITH ready AS (
      SELECT "id" FROM "IntelligenceWorkItem"
      WHERE "scheduledAt" <= now()
        AND "attempts" < ${maxAttempts}
        AND ("claimToken" IS NULL OR "leaseUntil" < now())
      ORDER BY "priority" ASC, "scheduledAt" ASC, "id" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
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

/** Releases the claim with a backoff. Items reaching the attempt ceiling become dead letters. */
export async function failWorkItem(
  item: Pick<ClaimedWorkItem, 'id' | 'claimToken' | 'attempts'>,
  error: unknown,
  client: Client = prisma,
  random: () => number = Math.random
): Promise<boolean> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
  const delayMs = computeRetryDelayMs(item.attempts, random);
  const updated = await client.$executeRaw(Prisma.sql`
    UPDATE "IntelligenceWorkItem"
    SET "claimToken" = NULL, "claimedAt" = NULL, "leaseUntil" = NULL, "lastError" = ${message},
        "scheduledAt" = now() + (${delayMs} * interval '1 millisecond'), "updatedAt" = now()
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
    select: { id: true, kind: true, subjectKey: true, attempts: true, lastError: true, updatedAt: true },
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
    data: { attempts: 0, scheduledAt: new Date(), claimToken: null, leaseUntil: null, lastError: null },
  });
  return replayed.count === 1;
}
