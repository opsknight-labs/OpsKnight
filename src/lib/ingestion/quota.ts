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
  if (client === prisma) return batchQuotaDecision(key, keys => decideQuota(keys, client));
  return (await decideQuota([key], client))[0];
}

async function decideQuota(
  keys: readonly string[],
  client: Prisma.TransactionClient
): Promise<QuotaDecision[]> {
  try {
    const { policy, revision } = await getIngestionPolicy(client);
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const requests = [...counts].map(([key, requested]) => {
      const events = key.endsWith(':events');
      return {
        key, requested,
        rate: events ? policy.quotas.eventsPerMinute : policy.quotas.integrationPerMinute,
        burst: events ? policy.quotas.eventsBurst : policy.quotas.integrationBurst,
      };
    });
    // Keep the established VALUES path for a single hot key; multi-key batches
    // share one validated policy read and acquire rows in canonical byte order.
    const single = requests.length === 1 ? requests[0] : undefined;
    const requested = single
      ? Prisma.sql`${single.requested}`
      : Prisma.sql`(SELECT request.requested FROM quota_requests request WHERE request.key = EXCLUDED.key)`;
    const requestCte = single ? Prisma.empty : Prisma.sql`
      WITH quota_requests AS MATERIALIZED (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(requests)}::jsonb)
          AS request(key text, requested int, rate int, burst int)
      )`;
    const requestValues = single
      ? Prisma.sql`VALUES (${single.key}, ${Math.max(0, single.burst - single.requested)},
          ${single.rate}, ${single.burst}, statement_timestamp(), true,
          ${revision}::bigint, ${Math.min(single.burst, single.requested)})`
      : Prisma.sql`SELECT key, GREATEST(0, burst - requested), rate, burst, statement_timestamp(), true,
          ${revision}::bigint, LEAST(burst, requested)
        FROM quota_requests ORDER BY key COLLATE "C"`;
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
    const results = await client.$queryRaw<
      Array<{ key: string; granted: number; tokens: number; rate: number; burst: number; updatedAt: number }>
    >`
      ${requestCte}
      INSERT INTO "IngestionQuota" AS bucket
        ("key", "tokens", "rate", "burst", "updatedAt", "lastAllowed", "policyRevision", "lastGranted")
      ${requestValues}
      ON CONFLICT ("key") DO UPDATE SET
        "tokens" = ${available} - ${granted},
        "lastGranted" = ${granted},
        "lastAllowed" = ${available} >= 1,
        "rate" = ${effectiveRate}, "burst" = ${effectiveBurst},
        "policyRevision" = GREATEST(bucket."policyRevision", EXCLUDED."policyRevision"),
        "updatedAt" = GREATEST(bucket."updatedAt", EXCLUDED."updatedAt")
      RETURNING "key", "lastGranted" AS granted, "tokens", "rate", "burst",
        (EXTRACT(EPOCH FROM "updatedAt") * 1000)::double precision AS "updatedAt"
    `;
    const byKey = single ? undefined : new Map(results.map(result => [result.key, result]));
    const positions = single ? undefined : new Map<string, number>();
    return keys.map((key, ordinal) => {
      const result = single ? results[0] : byKey?.get(key);
      if (!result) throw new Error('Missing quota decision');
      const index = single ? ordinal : (positions!.get(key) ?? 0);
      positions?.set(key, index + 1);
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
