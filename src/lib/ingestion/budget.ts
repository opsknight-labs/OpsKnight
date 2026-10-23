import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { Prisma } from '@prisma/client';
import type { IngestionPolicy } from './policy-schema';

/** Independent counters retain the global bound and protected critical reserve. */
export async function reserveIngestionBudget(
  tx: Prisma.TransactionClient,
  input: {
    policy: IngestionPolicy;
    payloadBytes: number;
    critical: boolean;
    preferredShard: number;
  }
): Promise<number | undefined> {
  const { policy, payloadBytes, critical, preferredShard } = input;
  const reservedShards = Math.ceil((64 * policy.criticalReservePercent) / 100);
  const eligible = Prisma.sql`
    "pending" < ${Math.floor(policy.maxPending / 64)}
    AND "bytes" + ${payloadBytes} <= ${Math.floor(policy.maxPendingBytes / 64)}
    AND (${critical} OR "shard" >= ${reservedShards})
  `;
  // SKIP LOCKED is a concurrency hint, not evidence of exhausted capacity.
  // Retry only while a non-locking snapshot still shows eligible headroom.
  // No sleep is added to successful admission; total scheduled backoff is 50ms.
  for (const delay of [0, 5, 15, 30]) {
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
      addOperationalMetric('opsknight_ingestion_capacity_reservation_retries_total', 1);
    }
    const reserved = await tx.$queryRaw<Array<{ shard: number }>>`
    WITH candidate AS (
      SELECT "shard" FROM "IngestionBudget" WHERE ${eligible}
      ORDER BY ("shard" - ${preferredShard} + 64) % 64
      FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "IngestionBudget" budget SET "pending" = budget."pending" + 1,
      "bytes" = budget."bytes" + ${payloadBytes}
      FROM candidate WHERE budget."shard" = candidate."shard"
      RETURNING budget."shard"
  `;
    if (reserved[0]) return reserved[0].shard;
    if (delay === 30) break;
    const [capacity] = await tx.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM "IngestionBudget" WHERE ${eligible}) AS available
    `;
    if (!capacity?.available) {
      addOperationalMetric('opsknight_ingestion_capacity_rejections_total', 1, { reason: 'full' });
      return undefined;
    }
  }
  addOperationalMetric('opsknight_ingestion_capacity_rejections_total', 1, { reason: 'contended' });
  return undefined;
}
