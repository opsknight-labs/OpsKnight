import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { ingestionConfig } from './config';
import { IngestionUnavailableError } from './contract';
import { getIngestionPolicy } from './policy';

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
    const [result] = await client.$queryRaw<
      Array<{ allowed: boolean; remaining: number; resetAt: number; count: number }>
    >`
      INSERT INTO "IngestionQuota" AS bucket
        ("key", "tokens", "rate", "burst", "updatedAt", "lastAllowed", "policyRevision")
      VALUES (${key}, ${burst - 1}, ${rate}, ${burst}, statement_timestamp(), true, ${revision}::bigint)
      ON CONFLICT ("key") DO UPDATE SET
        "tokens" = CASE WHEN ${available} >= 1 THEN ${available} - 1 ELSE ${available} END,
        "lastAllowed" = ${available} >= 1,
        "rate" = ${effectiveRate}, "burst" = ${effectiveBurst},
        "policyRevision" = GREATEST(bucket."policyRevision", EXCLUDED."policyRevision"),
        "updatedAt" = GREATEST(bucket."updatedAt", EXCLUDED."updatedAt")
      RETURNING "lastAllowed" AS allowed, floor("tokens")::int AS remaining,
        ("burst" - floor("tokens"))::int AS count,
        (EXTRACT(EPOCH FROM "updatedAt") * 1000 +
          CEIL(GREATEST(0, 1 - "tokens") * 60000.0 / "rate"))::double precision AS "resetAt"
    `;
    if (!result) throw new Error('Missing quota decision');
    return result;
  } catch {
    throw new IngestionUnavailableError('Shared ingestion quota unavailable');
  }
}
