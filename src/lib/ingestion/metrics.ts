import prisma from '@/lib/prisma';

/** Persistent queue evidence survives worker restarts and exhausted leases. */
export async function collectIngestionQueueMetrics() {
  const rows = await prisma.$queryRaw<
    Array<{ status: string; count: bigint; oldestAgeSeconds: number }>
  >`
    SELECT "status", COUNT(*)::bigint AS count,
      GREATEST(0, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - MIN("acceptedAt")))::double precision AS "oldestAgeSeconds"
    FROM "IngestionReceipt" WHERE "status" IN ('PENDING', 'PROCESSING', 'DEAD')
    GROUP BY "status"
  `;
  return rows.map(row => ({ ...row, count: Number(row.count) }));
}
