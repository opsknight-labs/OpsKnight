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

/** Reserve a bounded commit group without one query per receipt. Row locks are
 * acquired eight at a time with SKIP LOCKED; other writers retain free shards.
 * All increments remain in the caller's receipt transaction.
 */
export async function reserveIngestionBudgets(
  tx: Prisma.TransactionClient,
  policy: IngestionPolicy,
  inputs: Array<{ payloadBytes: number; critical: boolean; preferredShard: number }>
): Promise<Array<number | undefined>> {
  if (!inputs.length) return [];
  if (inputs.length > 32) throw new Error('Invalid ingestion reservation group');
  const maximumPending = Math.floor(policy.maxPending / 64);
  const maximumBytes = BigInt(Math.floor(policy.maxPendingBytes / 64));
  const reservedShards = Math.ceil((64 * policy.criticalReservePercent) / 100);
  const held = new Map<
    number,
    { shard: number; pending: number; bytes: bigint; count: number; addedBytes: number }
  >();
  const results: Array<number | undefined> = inputs.map(() => undefined);
  let retries = 0;
  for (;;) {
    for (const [index, input] of inputs.entries()) {
      if (results.at(index) !== undefined) continue;
      const candidate = [...held.values()]
        .filter(
          row =>
            (input.critical || row.shard >= reservedShards) &&
            row.pending + row.count < maximumPending &&
            row.bytes + BigInt(row.addedBytes + input.payloadBytes) <= maximumBytes
        )
        .sort(
          (a, b) =>
            ((a.shard - input.preferredShard + 64) % 64) -
            ((b.shard - input.preferredShard + 64) % 64)
        )[0];
      if (candidate) {
        candidate.count++;
        candidate.addedBytes += input.payloadBytes;
        results.splice(index, 1, candidate.shard);
      }
    }
    const remaining = inputs.filter((_, index) => results.at(index) === undefined);
    if (!remaining.length) break;
    const critical = remaining.some(input => input.critical);
    const smallest = Math.min(...remaining.map(input => input.payloadBytes));
    const eligible = Prisma.sql`
      "pending" < ${maximumPending} AND "bytes" + ${smallest} <= ${maximumBytes}
      AND (${critical} OR "shard" >= ${reservedShards})
      ${held.size ? Prisma.sql`AND "shard" NOT IN (${Prisma.join([...held.keys()])})` : Prisma.empty}
    `;
    const rows = await tx.$queryRaw<Array<{ shard: number; pending: number; bytes: bigint }>>`
      SELECT "shard", "pending", "bytes" FROM "IngestionBudget"
      WHERE ${eligible} ORDER BY ("shard" - ${remaining[0].preferredShard} + 64) % 64
      FOR UPDATE SKIP LOCKED LIMIT 8
    `;
    for (const row of rows) held.set(row.shard, { ...row, count: 0, addedBytes: 0 });
    if (rows.length) continue;
    const [capacity] = await tx.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM "IngestionBudget" WHERE ${eligible}) AS available
    `;
    const reason = capacity?.available ? 'contended' : 'full';
    if (!capacity?.available || retries === 3) {
      addOperationalMetric('opsknight_ingestion_capacity_rejections_total', remaining.length, {
        reason,
      });
      break;
    }
    await new Promise(resolve => setTimeout(resolve, [5, 15, 30][retries++]));
    addOperationalMetric('opsknight_ingestion_capacity_reservation_retries_total', 1);
  }
  const changes = [...held.values()].filter(row => row.count);
  if (changes.length) {
    const updated = await tx.$executeRaw`
      UPDATE "IngestionBudget" budget SET "pending" = budget."pending" + changes.count,
        "bytes" = budget."bytes" + changes.bytes
      FROM (VALUES ${Prisma.join(changes.map(row => Prisma.sql`(${row.shard}::int, ${row.count}::int, ${row.addedBytes}::bigint)`))})
        AS changes(shard, count, bytes) WHERE budget."shard" = changes.shard
    `;
    if (updated !== changes.length) throw new Error('Ingestion reservation group unavailable');
  }
  return results;
}
