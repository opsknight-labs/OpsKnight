import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { runSerializableTransaction } from './db-utils';

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
 * SERIALIZABLE isolation makes the budget shared across application replicas.
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

  return runSerializableTransaction(async tx => {
    const existing = await tx.rateLimit.findUnique({ where: { key } });
    if (!existing) {
      const expiresAt = new Date(now.getTime() + intervalMs);
      await tx.rateLimit.upsert({
        where: { key },
        update: { count: 1, expiresAt },
        create: { key, count: 1, expiresAt },
      });
      return { allowed: true } as const;
    }

    const retryAt = new Date(existing.expiresAt.getTime() - burstToleranceMs);
    if (retryAt > now) {
      return { allowed: false, retryAt, reason: 'RATE_LIMITED' } as const;
    }

    const expiresAt = new Date(Math.max(existing.expiresAt.getTime(), now.getTime()) + intervalMs);
    await tx.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 }, expiresAt },
    });
    return { allowed: true } as const;
  }, 5);
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
