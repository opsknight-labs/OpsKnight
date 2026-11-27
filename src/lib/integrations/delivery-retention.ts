import prisma from '@/lib/prisma';
import { clampedIntegerEnv } from '@/lib/ingestion/config';

export const INBOUND_DELIVERY_RETENTION_BATCH = 1000;
export const INBOUND_DELIVERY_RETENTION_MAX_BATCHES = 10;
export const INBOUND_DELIVERY_RETENTION_PER_RUN =
  INBOUND_DELIVERY_RETENTION_BATCH * INBOUND_DELIVERY_RETENTION_MAX_BATCHES;
export const INBOUND_DELIVERY_RETENTION_DAYS = { fallback: 30, min: 1, max: 3650 } as const;

/** Days finished inbound delivery rows are kept (OPSKNIGHT_INBOUND_DELIVERY_RETENTION_DAYS, default 30). */
export function inboundDeliveryRetentionDays(): number {
  return clampedIntegerEnv(
    process.env.OPSKNIGHT_INBOUND_DELIVERY_RETENTION_DAYS,
    INBOUND_DELIVERY_RETENTION_DAYS
  );
}

/**
 * Delete finished (COMPLETED or FAILED) deliveries past the retention window, at most
 * 10 batches of 1,000 per run so a large backlog drains over several runs without holding locks.
 * PROCESSING rows are never touched: a live lease still owns them.
 */
export async function cleanupInboundDeliveries(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - inboundDeliveryRetentionDays() * 86_400_000);
  let deleted = 0;
  for (let batch = 0; batch < INBOUND_DELIVERY_RETENTION_MAX_BATCHES; batch++) {
    const rows = await prisma.inboundDelivery.findMany({
      where: { createdAt: { lt: cutoff }, status: { in: ['COMPLETED', 'FAILED'] } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: INBOUND_DELIVERY_RETENTION_BATCH,
    });
    if (rows.length === 0) break;
    const result = await prisma.inboundDelivery.deleteMany({
      where: { id: { in: rows.map(row => row.id) } },
    });
    deleted += result.count;
    if (rows.length < INBOUND_DELIVERY_RETENTION_BATCH || result.count === 0) break;
  }
  return deleted;
}
