import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { ingestionConfig } from './config';
import { IngestionUnavailableError } from './contract';
import { getIngestionPolicy } from './policy';
import { batchQuotaDecision, type QuotaDecision } from './quota-batch';

/** Distributed token bucket: one atomic decision per authenticated key.
 * Changing policy clamps existing credit rather than granting a new bucket.
 */
export async function checkIngestionQuota(
  key: string,
  legacyLimit: number,
  windowMs: number,
  client: Prisma.TransactionClient = prisma
) {
  if (ingestionConfig().mode === 'sync') return checkRateLimit(key, legacyLimit, windowMs);
  // Transaction clients must retain their caller's transaction boundary. Only
  // ordinary independent requests can share a durable quota decision.
  if (client === prisma) return batchQuotaDecision(key, count => decideQuota(key, count, client));
  return (await decideQuota(key, 1, client))[0];
}

async function decideQuota(
  key: string,
  requested: number,
  client: Prisma.TransactionClient
): Promise<QuotaDecision[]> {
  try {
    const { policy, revision } = await getIngestionPolicy(client);
    const events = key.endsWith(':events');
    const rate = events ? policy.quotas.eventsPerMinute : policy.quotas.integrationPerMinute;
    const burst = events ? policy.quotas.eventsBurst : policy.quotas.integrationBurst;
    // ON CONFLICT uses the current locked row after waiting for other replicas.
    // Backwards clock movement cannot create refill credit.
    const effectiveBurst = Prisma.sql`CASE WHEN EXCLUDED."policyRevision" >= bucket."policyRevision"
      THEN EXCLUDED."burst" ELSE bucket."burst" END`;
    const effectiveRate = Prisma.sql`CASE WHEN EXCLUDED."policyRevision" >= bucket."policyRevision"
      THEN EXCLUDED."rate" ELSE bucket."rate" END`;
    // Without an exact policy-change timestamp, the lower rate is conservative
    // for the entire elapsed interval. A delayed old reader cannot restore it.
    const available = Prisma.sql`LEAST((${effectiveBurst})::double precision, bucket."burst"::double precision,
      bucket."tokens" + GREATEST(0, EXTRACT(EPOCH FROM
        (EXCLUDED."updatedAt" - bucket."updatedAt"))) * LEAST(bucket."rate", ${effectiveRate}) / 60.0)`;
    const granted = Prisma.sql`LEAST(${requested}, GREATEST(0, floor(${available})))::int`;
    const [result] = await client.$queryRaw<
      Array<{ granted: number; tokens: number; rate: number; burst: number; updatedAt: number }>
    >`
      INSERT INTO "IngestionQuota" AS bucket
        ("key", "tokens", "rate", "burst", "updatedAt", "lastAllowed", "policyRevision", "lastGranted")
      VALUES (${key}, ${Math.max(0, burst - requested)}, ${rate}, ${burst}, statement_timestamp(), true, ${revision}::bigint, ${Math.min(burst, requested)})
      ON CONFLICT ("key") DO UPDATE SET
        "tokens" = ${available} - ${granted},
        "lastGranted" = ${granted},
        "lastAllowed" = ${available} >= 1,
        "rate" = ${effectiveRate}, "burst" = ${effectiveBurst},
        "policyRevision" = GREATEST(bucket."policyRevision", EXCLUDED."policyRevision"),
        "updatedAt" = GREATEST(bucket."updatedAt", EXCLUDED."updatedAt")
      RETURNING "lastGranted" AS granted, "tokens", "rate", "burst",
        (EXTRACT(EPOCH FROM "updatedAt") * 1000)::double precision AS "updatedAt"
    `;
    if (!result) throw new Error('Missing quota decision');
    return Array.from({ length: requested }, (_, index) => {
      const allowed = index < result.granted;
      const tokens = result.tokens + (allowed ? result.granted - index - 1 : 0);
      const remaining = Math.floor(tokens);
      return {
        allowed,
        remaining,
        count: result.burst - remaining,
        resetAt: result.updatedAt + Math.ceil((Math.max(0, 1 - tokens) * 60000) / result.rate),
      };
    });
  } catch {
    throw new IngestionUnavailableError('Shared ingestion quota unavailable');
  }
}
