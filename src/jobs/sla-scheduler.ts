import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { generateDailySnapshot } from '@/lib/sla-server';

/**
 * Processes pending SLA snapshots for the previous day.
 * Should be called periodically (e.g., every hour) to ensure eventual consistency.
 * Idempotent: Can be run multiple times safely.
 */
export async function processSLASnapshots() {
  const now = new Date();
  const yesterdayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  );

  const startOfYesterday = new Date(yesterdayUtc);
  const endOfYesterday = new Date(yesterdayUtc);
  endOfYesterday.setUTCHours(23, 59, 59, 999);

  try {
    // 1. Find all active SLA Definitions
    const definitions = await prisma.sLADefinition.findMany({
      where: {
        activeFrom: { lte: endOfYesterday },
        OR: [{ activeTo: null }, { activeTo: { gte: startOfYesterday } }],
      },
    });

    let processedCount = 0;

    for (const def of definitions) {
      // 2. Check if snapshot already exists for yesterday
      const existing = await prisma.sLASnapshot.findUnique({
        where: {
          date_slaDefinitionId: {
            date: startOfYesterday,
            slaDefinitionId: def.id,
          },
        },
      });

      if (!existing || existing.denominatorUnknown) {
        // 3. Generate Snapshot if missing
        await generateDailySnapshot(def.id, startOfYesterday);
        processedCount++;
      } else {
        // Optional: Recalculate if we want to support "updating" results?
        // For now, assume immutable once created for efficiency
      }
    }

    if (processedCount > 0) {
      logger.info('[SLA] Generated daily snapshots', {
        date: startOfYesterday.toISOString().split('T')[0],
        count: processedCount,
      });
    }

    return { processed: processedCount, total: definitions.length };
  } catch (error) {
    logger.error('[SLA] Failed to process snapshots', { error });
    return { processed: 0, error: true };
  }
}
