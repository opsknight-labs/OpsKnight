import { AppError } from '@/lib/errors';
import { checkRateLimit, incrementSharedCounter } from '@/lib/rate-limit';
import { rateLimitMemoryCache } from './cache';
import { recordRateLimitDecision } from './observability';

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
  recordRateLimitDecision(operationClass, result.allowed);
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

export const FAILED_AUTH_ADMISSION_LIMIT = 60;
export const FAILED_AUTH_ADMISSION_WINDOW_MS = 60_000;

/**
 * Unidentified clients (direct Docker without a trusted proxy, or no usable
 * forwarded address) share one bucket. A per-IP quota there would let one abuser
 * lock out every unrelated client, and no quota lets one abuser drive unlimited
 * database and scrypt work. They therefore get work budgets instead of a
 * blocking quota: bounded concurrent verifications, and a separate, stricter
 * budget for CPU-expensive legacy scrypt verification. Neither ever rejects a
 * modern-format token on the basis of other clients' failures.
 */
export const UNIDENTIFIED_VERIFICATION_CONCURRENCY = envInt(
  'API_V2_UNIDENTIFIED_AUTH_CONCURRENCY',
  16
);
export const UNIDENTIFIED_QUEUE_WAIT_MS = envInt('API_V2_UNIDENTIFIED_AUTH_QUEUE_MS', 250);
export const LEGACY_SCRYPT_CONCURRENCY = envInt('API_V2_LEGACY_SCRYPT_CONCURRENCY', 2);
export const LEGACY_UNIDENTIFIED_LIMIT = envInt('API_V2_LEGACY_UNIDENTIFIED_LIMIT', 30);

/** Backwards compatibility alias */
export const GENERAL_PRE_AUTH_ADMISSION_LIMIT = FAILED_AUTH_ADMISSION_LIMIT;
export const GENERAL_PRE_AUTH_ADMISSION_WINDOW_MS = FAILED_AUTH_ADMISSION_WINDOW_MS;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isUnidentifiedClient(clientIp: string | undefined | null): boolean {
  const ip = (clientIp ?? '').trim();
  return !ip || ip === '0.0.0.0' || ip === 'unknown';
}

function overloaded(message: string, retryAfter: number, limit?: number): AppError {
  return new AppError({
    code: 'RATE_LIMIT_EXCEEDED',
    userMessage: message,
    details: { retryAfter, ...(limit ? { limit } : {}) },
  });
}

function secondsToWindowEnd(windowMs: number, now = Date.now()): number {
  const windowStart = Math.floor(now / windowMs);
  return Math.max(1, Math.ceil(((windowStart + 1) * windowMs - now) / 1000));
}

class ConcurrencyLane {
  private active = 0;
  private readonly waiters: Array<(release: (() => void) | null) => void> = [];

  constructor(
    private readonly maxActive: () => number,
    private readonly maxQueued = 0
  ) {}

  private grant(): () => void {
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next(this.grant());
    };
  }

  tryAcquire(): (() => void) | null {
    return this.active < this.maxActive() ? this.grant() : null;
  }

  /** Acquire a slot, waiting briefly for one to free up before giving up. */
  async acquire(maxWaitMs: number): Promise<(() => void) | null> {
    const immediate = this.tryAcquire();
    if (immediate || maxWaitMs <= 0 || this.waiters.length >= this.maxQueued) return immediate;
    return new Promise(resolve => {
      const waiter = (release: (() => void) | null) => {
        clearTimeout(timer);
        resolve(release);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(null);
      }, maxWaitMs);
      this.waiters.push(waiter);
    });
  }

  get inFlight(): number {
    return this.active;
  }
}

declare global {
  var __v2UnidentifiedLane: ConcurrencyLane | undefined;
  var __v2LegacyScryptLane: ConcurrencyLane | undefined;
}

const unidentifiedLane = (globalThis.__v2UnidentifiedLane ??= new ConcurrencyLane(
  () => UNIDENTIFIED_VERIFICATION_CONCURRENCY,
  64
));
const legacyScryptLane = (globalThis.__v2LegacyScryptLane ??= new ConcurrencyLane(
  () => LEGACY_SCRYPT_CONCURRENCY
));

/**
 * Bound concurrent database token verifications for unidentified clients.
 * Returns a release function; identified clients are not bounded here because
 * they are governed by the per-IP failed-authentication limit.
 */
export async function acquireVerificationSlot(clientIp: string): Promise<() => void> {
  if (!isUnidentifiedClient(clientIp)) return () => {};
  // A short bounded wait absorbs bursts of legitimate traffic; only sustained overload is shed.
  const release = await unidentifiedLane.acquire(UNIDENTIFIED_QUEUE_WAIT_MS);
  if (!release) {
    throw overloaded(
      'Too many concurrent authentication attempts. Please retry shortly.',
      1,
      UNIDENTIFIED_VERIFICATION_CONCURRENCY
    );
  }
  return release;
}

/**
 * Bound concurrent legacy scrypt work for every client. scrypt is CPU- and
 * memory-hard, so even identified clients share a per-process ceiling.
 */
export function acquireLegacyScryptSlot(): () => void {
  const release = legacyScryptLane.tryAcquire();
  if (!release) {
    throw overloaded(
      'Legacy token verification is busy. Please retry shortly.',
      1,
      LEGACY_SCRYPT_CONCURRENCY
    );
  }
  return release;
}

function failedAuthKey(ip: string, windowStart: number): string {
  return `v2:failed-auth-ip:${ip}:${windowStart}`;
}

/**
 * Whether an identified client IP has exhausted its failed-authentication budget.
 *
 * The shared PostgreSQL counter is authoritative. Every replica folds the
 * post-increment shared count into local memory whenever it records a failure,
 * so this check is a memory read on the hot path. A replica that has never seen
 * a failure from an IP can admit that IP's first lookup; that lookup records
 * against the shared counter and the replica then learns the global state. An
 * attacker spreading failures across N replicas therefore gets at most N
 * attempts beyond the limit per window, not N times the limit.
 *
 * Unidentified clients are never blocked here (see the module notes above).
 */
export async function isFailedAuthAdmissionBlocked(clientIp: string): Promise<boolean> {
  if (isUnidentifiedClient(clientIp)) return false;
  const ip = clientIp.trim();
  const windowStart = Math.floor(Date.now() / FAILED_AUTH_ADMISSION_WINDOW_MS);
  return (
    (rateLimitMemoryCache.get(failedAuthKey(ip, windowStart)) ?? 0) >= FAILED_AUTH_ADMISSION_LIMIT
  );
}

export function failedAuthRetryAfterSeconds(): number {
  return secondsToWindowEnd(FAILED_AUTH_ADMISSION_WINDOW_MS);
}

/**
 * Record a failed authentication attempt against an identified client IP in the
 * shared PostgreSQL counter and adopt the shared count locally. If the database
 * is unreachable the local count alone applies (fail open: authentication
 * itself already depends on the same database).
 */
export async function recordFailedAuthAttempt(clientIp: string): Promise<void> {
  if (isUnidentifiedClient(clientIp)) return;
  const ip = clientIp.trim();
  const windowStart = Math.floor(Date.now() / FAILED_AUTH_ADMISSION_WINDOW_MS);
  const memKey = failedAuthKey(ip, windowStart);

  const localCount = (rateLimitMemoryCache.get(memKey) ?? 0) + 1;
  let count = localCount;
  try {
    const shared = await incrementSharedCounter(
      `api:v2:failed-auth:${ip}`,
      FAILED_AUTH_ADMISSION_WINDOW_MS
    );
    count = Math.max(localCount, shared.count);
  } catch {
    // Rely on the local count.
  }
  rateLimitMemoryCache.set(memKey, count, FAILED_AUTH_ADMISSION_WINDOW_MS);
}

/**
 * Admission for CPU-expensive legacy (scrypt) token verification, applied only
 * to legacy-shaped tokens that missed the fast lookup.
 * - Identified clients: per-IP shared budget.
 * - Unidentified clients: one stricter shared budget for the whole bucket, so
 *   legacy floods cannot burn CPU. Only legacy-format tokens are shed.
 */
export async function checkLegacyTokenAdmission(clientIp: string): Promise<boolean> {
  const unidentified = isUnidentifiedClient(clientIp);
  const subject = unidentified ? 'unidentified' : clientIp.trim();
  const limit = unidentified ? LEGACY_UNIDENTIFIED_LIMIT : LEGACY_AUTH_ADMISSION_LIMIT;
  const windowStart = Math.floor(Date.now() / LEGACY_AUTH_ADMISSION_WINDOW_MS);
  const memKey = `v2:legacy-scrypt-ip:${subject}:${windowStart}`;

  const currentCount = rateLimitMemoryCache.get(memKey) ?? 0;
  if (currentCount >= limit) return false;
  rateLimitMemoryCache.set(memKey, currentCount + 1, LEGACY_AUTH_ADMISSION_WINDOW_MS);

  try {
    const shared = await incrementSharedCounter(
      `api:v2:legacy-scrypt:${subject}`,
      LEGACY_AUTH_ADMISSION_WINDOW_MS
    );
    if (shared.count > limit) {
      rateLimitMemoryCache.set(memKey, shared.count, LEGACY_AUTH_ADMISSION_WINDOW_MS);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function legacyAdmissionRetryAfterSeconds(): number {
  return secondsToWindowEnd(LEGACY_AUTH_ADMISSION_WINDOW_MS);
}

/**
 * Backwards-compatibility wrapper for admission checks.
 */
export async function checkPreAuthAdmission(clientIp: string): Promise<boolean> {
  return !(await isFailedAuthAdmissionBlocked(clientIp));
}
