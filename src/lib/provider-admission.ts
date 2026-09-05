import { Prisma } from '@prisma/client';
import prisma from './prisma';

export type ProviderAdmissionScope = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH' | 'SLACK' | 'WEBHOOK';

export type ProviderAdmissionResult =
  | { allowed: true }
  | { allowed: false; retryAt: Date; reason: 'RATE_LIMITED' };

export type ProviderConcurrencyResult =
  | { allowed: true; leaseKey: string }
  | { allowed: false; retryAt: Date; reason: 'MAX_IN_FLIGHT' };

const DEFAULT_LIMITS: Record<
  ProviderAdmissionScope,
  { limit: number; windowMs: number; maxInFlight: number }
> = {
  EMAIL: { limit: 8, windowMs: 1_000, maxInFlight: 5 },
  SMS: { limit: 20, windowMs: 1_000, maxInFlight: 10 },
  WHATSAPP: { limit: 50, windowMs: 1_000, maxInFlight: 10 },
  PUSH: { limit: 100, windowMs: 1_000, maxInFlight: 20 },
  SLACK: { limit: 1, windowMs: 1_000, maxInFlight: 2 },
  WEBHOOK: { limit: 20, windowMs: 1_000, maxInFlight: 10 },
};

function providerLimit(scope: ProviderAdmissionScope): {
  limit: number;
  windowMs: number;
  maxInFlight: number;
} {
  switch (scope) {
    case 'EMAIL':
      return DEFAULT_LIMITS.EMAIL;
    case 'SMS':
      return DEFAULT_LIMITS.SMS;
    case 'WHATSAPP':
      return DEFAULT_LIMITS.WHATSAPP;
    case 'PUSH':
      return DEFAULT_LIMITS.PUSH;
    case 'SLACK':
      return DEFAULT_LIMITS.SLACK;
    case 'WEBHOOK':
      return DEFAULT_LIMITS.WEBHOOK;
  }
}
const PROVIDER_LEASE_MS = 10 * 60_000;

function bucketKey(scope: ProviderAdmissionScope, providerKey: string): string {
  return `provider:${scope.toLowerCase()}:${providerKey}`.slice(0, 240);
}

/**
 * Distributed provider admission control using OpsKnight's existing RateLimit table.
 * A conditional UPSERT serializes writers for one provider bucket without holding a
 * serializable read-then-write transaction. This is important during multi-channel
 * fan-out, where competing first writes previously exhausted transaction retries.
 */
export async function acquireProviderAdmission(
  scope: ProviderAdmissionScope,
  providerKey: string,
  now: Date = new Date()
): Promise<ProviderAdmissionResult> {
  const config = providerLimit(scope);
  const key = bucketKey(scope, providerKey);
  const intervalMs = config.windowMs / config.limit;
  const burstToleranceMs = intervalMs * Math.max(0, config.limit - 1);
  const expiresAt = new Date(now.getTime() + intervalMs);
  const eligibleAt = new Date(now.getTime() + burstToleranceMs);
  const admitted = await prisma.$queryRaw<Array<{ expiresAt: Date }>>(Prisma.sql`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = "RateLimit"."count" + 1,
      "expiresAt" = GREATEST("RateLimit"."expiresAt", ${now}) + (${intervalMs} * INTERVAL '1 millisecond')
    WHERE "RateLimit"."expiresAt" <= ${eligibleAt}
    RETURNING "expiresAt"
  `);
  if (admitted.length > 0) return { allowed: true };

  // A conflicting row that did not satisfy the conditional update represents a
  // shared budget that is full. Read it after the UPSERT lock has been released
  // to calculate a precise scheduler wake-up rather than failing the delivery.
  const existing = await prisma.rateLimit.findUnique({ where: { key } });
  if (existing) {
    return {
      allowed: false,
      retryAt: new Date(existing.expiresAt.getTime() - burstToleranceMs),
      reason: 'RATE_LIMITED',
    };
  }

  // Cleanup can delete an expired row between the conditional UPSERT and the
  // read. A short deferral lets the worker safely retry instead of reporting a
  // transient storage race as a provider failure.
  return {
    allowed: false,
    retryAt: new Date(now.getTime() + intervalMs),
    reason: 'RATE_LIMITED',
  };
}

/** Persist a provider-supplied cooldown (for example HTTP Retry-After) across replicas. */
export async function deferProviderAdmission(
  scope: ProviderAdmissionScope,
  providerKey: string,
  retryAt: Date
): Promise<void> {
  const config = providerLimit(scope);
  const key = bucketKey(scope, providerKey);
  const intervalMs = config.windowMs / config.limit;
  const cooldownTheoreticalArrival = new Date(
    retryAt.getTime() + intervalMs * Math.max(0, config.limit - 1)
  );
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, ${config.limit}, ${cooldownTheoreticalArrival})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = GREATEST("RateLimit"."count", EXCLUDED."count"),
      "expiresAt" = GREATEST("RateLimit"."expiresAt", EXCLUDED."expiresAt")
  `);
}

/** Distributed concurrency slots with expiring leases for crashed workers. */
export async function acquireProviderConcurrency(
  scope: ProviderAdmissionScope,
  providerKey: string,
  now: Date = new Date()
): Promise<ProviderConcurrencyResult> {
  const config = providerLimit(scope);
  const prefix = bucketKey(scope, providerKey).replace(/^provider:/, 'provider-inflight:');
  const expiresAt = new Date(now.getTime() + PROVIDER_LEASE_MS);
  for (let slot = 0; slot < config.maxInFlight; slot += 1) {
    const leaseKey = `${prefix}:${slot}`.slice(0, 240);
    const claimed = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
      INSERT INTO "RateLimit" ("key", "count", "expiresAt")
      VALUES (${leaseKey}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = 1,
        "expiresAt" = EXCLUDED."expiresAt"
      WHERE "RateLimit"."expiresAt" <= ${now}
      RETURNING "key"
    `);
    if (claimed.length > 0) return { allowed: true, leaseKey };
  }
  return {
    allowed: false,
    retryAt: new Date(now.getTime() + 1_000),
    reason: 'MAX_IN_FLIGHT',
  };
}

export async function releaseProviderConcurrency(leaseKey: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key: leaseKey } });
}

export class ProviderCooldownError extends Error {
  constructor(
    readonly providerKey: string,
    readonly retryAt: Date
  ) {
    super(`Provider ${providerKey} is in cooldown until ${retryAt.toISOString()}`);
    this.name = 'ProviderCooldownError';
  }
}

export async function assertProviderAdmitted(key: string, now = new Date()): Promise<void> {
  const admission = await prisma.providerAdmission.findUnique({ where: { key } });
  if (admission?.blockedUntil && admission.blockedUntil > now) {
    throw new ProviderCooldownError(key, admission.blockedUntil);
  }
}

export async function recordProviderSuccess(key: string): Promise<void> {
  await prisma.providerAdmission.upsert({
    where: { key },
    create: { key, state: 'CLOSED', lastSuccessAt: new Date() },
    update: {
      state: 'CLOSED',
      blockedUntil: null,
      consecutiveFails: 0,
      lastSuccessAt: new Date(),
      lastStatusCode: null,
    },
  });
}

export async function recordProviderFailure(
  key: string,
  options: { statusCode?: number; retryAfterMs?: number } = {}
): Promise<void> {
  const now = new Date();
  const blockedUntil = options.retryAfterMs
    ? new Date(now.getTime() + Math.min(Math.max(options.retryAfterMs, 1_000), 24 * 60 * 60_000))
    : undefined;
  await prisma.providerAdmission.upsert({
    where: { key },
    create: {
      key,
      state: blockedUntil ? 'OPEN' : 'DEGRADED',
      blockedUntil,
      consecutiveFails: 1,
      lastFailureAt: now,
      lastStatusCode: options.statusCode,
    },
    update: {
      state: blockedUntil ? 'OPEN' : 'DEGRADED',
      blockedUntil,
      consecutiveFails: { increment: 1 },
      lastFailureAt: now,
      lastStatusCode: options.statusCode,
    },
  });
}
