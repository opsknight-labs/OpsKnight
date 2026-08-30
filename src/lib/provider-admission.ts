import { Prisma } from '@prisma/client';
import prisma from './prisma';

export type ProviderAdmissionScope = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH' | 'WEBHOOK';

export type ProviderAdmissionResult =
  | { allowed: true }
  | { allowed: false; retryAt: Date; reason: 'RATE_LIMITED' };

const DEFAULT_LIMITS: Record<ProviderAdmissionScope, { limit: number; windowMs: number }> = {
  EMAIL: { limit: 8, windowMs: 1_000 },
  SMS: { limit: 20, windowMs: 1_000 },
  WHATSAPP: { limit: 50, windowMs: 1_000 },
  PUSH: { limit: 100, windowMs: 1_000 },
  WEBHOOK: { limit: 20, windowMs: 1_000 },
};

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
  const config = DEFAULT_LIMITS[scope];
  const key = bucketKey(scope, providerKey);

  return prisma.$transaction(
    async tx => {
      const existing = await tx.rateLimit.findUnique({ where: { key } });
      if (!existing || existing.expiresAt <= now) {
        const expiresAt = new Date(now.getTime() + config.windowMs);
        await tx.rateLimit.upsert({
          where: { key },
          update: { count: 1, expiresAt },
          create: { key, count: 1, expiresAt },
        });
        return { allowed: true } as const;
      }

      if (existing.count >= config.limit) {
        return { allowed: false, retryAt: existing.expiresAt, reason: 'RATE_LIMITED' } as const;
      }

      await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
      return { allowed: true } as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
