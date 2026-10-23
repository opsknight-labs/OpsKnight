import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { ingestionConfig } from './config';
import { IngestionUnavailableError } from './contract';

type Lease = {
  tokens: number;
  exhausted: boolean;
  deadline: number;
  resetAt: number;
  count: number;
};
const leases = new Map<string, Lease>();
const allocations = new Map<string, Promise<void>>();

/**
 * Conservative distributed fixed-window quotas. Reserve small token blocks so
 * one integration does not update the same PostgreSQL row on every request.
 * Unused tokens expire rather than being refunded or duplicated after restart.
 */
export async function checkIngestionQuota(key: string, legacyLimit: number, windowMs: number) {
  const config = ingestionConfig();
  if (config.mode === 'sync') return checkRateLimit(key, legacyLimit, windowMs);
  const limit = key.endsWith(':events') ? config.eventsPerMinute : config.integrationPerMinute;
  const cacheKey = `${key}:${limit}:${windowMs}`;
  const block = Math.max(1, Math.min(64, Math.floor(limit / 8)));
  while (true) {
    const lease = leases.get(cacheKey);
    if (lease && performance.now() < lease.deadline) {
      if (lease.tokens > 0) {
        lease.tokens -= 1;
        return {
          allowed: true,
          remaining: Math.max(0, limit - lease.count + lease.tokens),
          resetAt: lease.resetAt,
          count: lease.count,
        };
      }
      if (lease.exhausted)
        return { allowed: false, remaining: 0, resetAt: lease.resetAt, count: limit + 1 };
    }
    let allocation = allocations.get(cacheKey);
    if (!allocation) {
      allocation = (async () => {
        const started = performance.now();
        const [reservation] = await prisma.$queryRaw<
          Array<{ count: number | null; resetAt: number; remainingMs: number }>
        >`
          WITH clock AS (
            SELECT EXTRACT(EPOCH FROM statement_timestamp()) * 1000 AS now_ms
          ), quota_window AS (
            SELECT floor(now_ms / ${windowMs}) AS bucket,
              (floor(now_ms / ${windowMs}) + 1) * ${windowMs} AS reset_ms, now_ms FROM clock
          ), reservation AS (
            INSERT INTO "RateLimit" ("key", "count", "expiresAt")
            SELECT concat(${`ingestion-quota:${cacheKey}:`}, bucket), ${Math.min(block, limit)},
              to_timestamp(reset_ms / 1000) FROM quota_window
            ON CONFLICT ("key") DO UPDATE SET
              "count" = "RateLimit"."count" + LEAST(${block}, ${limit} - "RateLimit"."count")
            WHERE "RateLimit"."count" < ${limit}
            RETURNING "count"
          ) SELECT reservation."count", quota_window.reset_ms::double precision AS "resetAt",
            (quota_window.reset_ms - quota_window.now_ms)::double precision AS "remainingMs"
          FROM quota_window LEFT JOIN reservation ON true
        `;
        if (!reservation) throw new Error('Missing quota reservation');
        // Previous reservations are multiples of block until the final partial block.
        const tokens =
          reservation.count === null
            ? 0
            : reservation.count === limit
              ? limit % block || block
              : block;
        if (leases.size >= 4096) leases.delete(leases.keys().next().value!);
        leases.set(cacheKey, {
          tokens,
          exhausted: reservation.count === null,
          deadline: started + Math.max(0, reservation.remainingMs - 1),
          resetAt: reservation.resetAt,
          count: reservation.count ?? limit,
        });
      })();
      allocations.set(cacheKey, allocation);
    }
    try {
      await allocation;
    } catch {
      throw new IngestionUnavailableError('Shared ingestion quota unavailable');
    } finally {
      if (allocations.get(cacheKey) === allocation) allocations.delete(cacheKey);
    }
  }
}
