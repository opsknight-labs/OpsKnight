import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Check rate limit using PostgreSQL for distributed coordination
 * Uses a tiered approach:
 * 1. Checks atomic counter in DB
 * 2. Auto-expires records via cleanup (simplified for this implementation)
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number; count: number }> {
  try {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs);
    const dbKey = `${key}:${windowStart}`; // Unique key per window
    const expiresAt = new Date(now + windowMs);

    // Atomic increment using upsert
    // If record exists, increment count. If not, create with count 1.
    const result = await prisma.rateLimit.upsert({
      where: { key: dbKey },
      create: {
        key: dbKey,
        count: 1,
        expiresAt,
      },
      update: {
        count: { increment: 1 },
      },
    });

    const resetAt = (windowStart + 1) * windowMs;
    const count = typeof result?.count === 'number' ? result.count : 1;
    const remaining = Math.max(0, limit - count);

    return {
      allowed: count <= limit,
      remaining,
      resetAt,
      count,
    };
  } catch (error) {
    logger.error('Rate limit DB check failed, blocking request for safety', { error });
    // Allow health checks through even when rate limit DB is down
    if (key.startsWith('health:') || key.startsWith('internal:')) {
      return { allowed: true, remaining: 1, resetAt: Date.now() + windowMs, count: 0 };
    }
    return {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + windowMs,
      count: limit + 1,
    };
  }
}

/**
 * Atomically increment a shared fixed-window counter in PostgreSQL and return
 * the post-increment count. Unlike checkRateLimit this throws on database
 * failure, so callers can choose their own fail-open/fail-closed policy
 * instead of inheriting the fail-closed behaviour of request admission.
 */
export async function incrementSharedCounter(
  key: string,
  windowMs: number,
  clock: 'application' | 'database' = 'application'
): Promise<{ count: number; resetAt: number }> {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error('Invalid rate-limit window');
  if (clock === 'database') {
    const [result] = await prisma.$queryRaw<Array<{ count: number; resetAt: number }>>`
      WITH clock AS (
        SELECT floor(EXTRACT(EPOCH FROM statement_timestamp()) * 1000 / ${windowMs})::bigint AS window
      ) INSERT INTO "RateLimit" ("key", "count", "expiresAt")
        SELECT ${key} || ':' || clock.window::text, 1,
          to_timestamp((clock.window + 1) * ${windowMs} / 1000.0) FROM clock
      ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1
      RETURNING "count", (EXTRACT(EPOCH FROM "expiresAt") * 1000)::double precision AS "resetAt"
    `;
    if (!result) throw new Error('Missing shared counter result');
    return result;
  }
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs);
  const resetAt = (windowStart + 1) * windowMs;
  const result = await prisma.rateLimit.upsert({
    where: { key: `${key}:${windowStart}` },
    create: { key: `${key}:${windowStart}`, count: 1, expiresAt: new Date(resetAt) },
    update: { count: { increment: 1 } },
  });
  return { count: typeof result?.count === 'number' ? result.count : 1, resetAt };
}

/**
 * Cleanup expired rate limit records (called by background cron maintenance)
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
  try {
    const result = await prisma.rateLimit.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        key: {
          not: {
            startsWith: 'mutex:',
          },
        },
      },
    });
    return result.count;
  } catch (error) {
    logger.error('Failed to cleanup rate limits', { error });
    return 0;
  }
}

// Stub for interface compatibility if needed, though we moved to async
export function getRateLimitStoreSize(): number {
  return 0; // Stateless
}
