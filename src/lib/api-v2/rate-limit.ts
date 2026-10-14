import { AppError } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { rateLimitMemoryCache } from './cache';

export type V2OperationClass = 'READ' | 'WRITE' | 'SEARCH_EXPORT';

export const RATE_LIMIT_CONFIGS: Record<V2OperationClass, { limit: number; windowMs: number }> = {
  READ: { limit: 120, windowMs: 60_000 },
  WRITE: { limit: 60, windowMs: 60_000 },
  SEARCH_EXPORT: { limit: 30, windowMs: 60_000 },
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export async function checkV2RateLimit(
  apiKeyId: string,
  operationClass: V2OperationClass = 'READ'
): Promise<RateLimitResult> {
  const config = RATE_LIMIT_CONFIGS[operationClass];
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs);
  const memKey = `v2:rl:${apiKeyId}:${operationClass}:${windowStart}`;

  // 1. In-memory fast path (Memory shield)
  const currentMemCount = rateLimitMemoryCache.get(memKey) ?? 0;
  if (currentMemCount >= config.limit) {
    const resetAt = (windowStart + 1) * config.windowMs;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }

  // Increment in-memory counter
  rateLimitMemoryCache.set(memKey, currentMemCount + 1, config.windowMs);

  // 2. PostgreSQL distributed persistence across instances
  const dbKey = `api:v2:${apiKeyId}:${operationClass}`;
  const pgResult = await checkRateLimit(dbKey, config.limit, config.windowMs);

  const resetAt = pgResult.resetAt;
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  const remaining = pgResult.remaining;

  return {
    allowed: pgResult.allowed,
    limit: config.limit,
    remaining,
    resetAt,
    retryAfter,
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
  };

  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfter);
  }

  return headers;
}

export async function enforceV2RateLimit(
  apiKeyId: string,
  operationClass: V2OperationClass = 'READ'
): Promise<Record<string, string>> {
  const result = await checkV2RateLimit(apiKeyId, operationClass);
  const headers = rateLimitHeaders(result);

  if (!result.allowed) {
    throw new AppError({
      code: 'RATE_LIMIT_EXCEEDED',
      userMessage: `Rate limit of ${result.limit} requests per minute exceeded. Try again in ${result.retryAfter} seconds.`,
      details: {
        limit: result.limit,
        remaining: result.remaining,
        retryAfter: result.retryAfter,
        resetAt: new Date(result.resetAt).toISOString(),
      },
    });
  }

  return headers;
}

export const LEGACY_AUTH_ADMISSION_LIMIT = 10;
export const LEGACY_AUTH_ADMISSION_WINDOW_MS = 60_000;

/**
 * Pre-authentication IP-based admission limit for legacy token verification.
 * Shields the Node.js event loop and CPU from expensive scrypt operations
 * when an attacker floods invalid 1.x-shaped tokens before API key rate limiting runs.
 */
export async function checkLegacyTokenAdmission(clientIp: string): Promise<boolean> {
  const sanitizedIp = clientIp.trim() || 'unknown';
  const now = Date.now();
  const windowStart = Math.floor(now / LEGACY_AUTH_ADMISSION_WINDOW_MS);
  const memKey = `v2:legacy-scrypt-ip:${sanitizedIp}:${windowStart}`;

  // 1. In-memory fast shield (protects PostgreSQL and event loop under high burst)
  const currentCount = rateLimitMemoryCache.get(memKey) ?? 0;
  if (currentCount >= LEGACY_AUTH_ADMISSION_LIMIT) {
    return false;
  }
  rateLimitMemoryCache.set(memKey, currentCount + 1, LEGACY_AUTH_ADMISSION_WINDOW_MS);

  // 2. Distributed coordination across replicas via PostgreSQL RateLimit
  try {
    const dbKey = `api:v2:legacy-scrypt:${sanitizedIp}`;
    const pgResult = await checkRateLimit(
      dbKey,
      LEGACY_AUTH_ADMISSION_LIMIT,
      LEGACY_AUTH_ADMISSION_WINDOW_MS
    );
    return pgResult.allowed;
  } catch {
    // If DB check fails, rely on in-memory decision
    return true;
  }
}
