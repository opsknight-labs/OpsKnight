import 'server-only';
import { logger } from './logger';
import { getRetentionPolicy } from './retention-policy';
import { cleanupOldRollups } from './metric-rollup';

/**
 * Data Cleanup Service
 *
 * Enforces data retention policies by archiving/deleting old data.
 * Should be run as a scheduled job (e.g., daily at 2 AM).
 *
 * IMPORTANT: This is a destructive operation. In production,
 * consider archiving data to cold storage before deletion.
 */

export interface CleanupResult {
  incidents: number;
  alerts: number;
  logs: number;
  metrics: number;
  events: number;
  executionTimeMs: number;
  dryRun: boolean;
}

/**
 * Performs data cleanup based on retention policy
 *
 * @param dryRun - If true, only logs what would be deleted without actually deleting
 */
export async function performDataCleanup(dryRun: boolean = false): Promise<CleanupResult> {
  const startTime = Date.now();
  const { default: prisma } = await import('./prisma');
  const policy = await getRetentionPolicy();

  logger.info('[DataCleanup] Starting cleanup', {
    dryRun,
    policy,
  });

  const now = new Date();

  // Calculate cutoff dates
  const incidentCutoff = new Date(now);
  incidentCutoff.setDate(incidentCutoff.getDate() - policy.incidentRetentionDays);

  const alertCutoff = new Date(now);
  alertCutoff.setDate(alertCutoff.getDate() - policy.alertRetentionDays);

  const logCutoff = new Date(now);
  logCutoff.setDate(logCutoff.getDate() - policy.logRetentionDays);

  let incidentCount = 0;
  let alertCount = 0;
  let logCount = 0;
  let metricsCount = 0;
  let eventCount = 0;

  try {
    // 1. Count what would be deleted
    const [incidentsToDelete, alertsToDelete, logsToDelete] = await Promise.all([
      prisma.incident.count({
        where: {
          createdAt: { lt: incidentCutoff },
          status: 'RESOLVED', // Only delete resolved incidents
        },
      }),
      prisma.alert.count({
        where: { createdAt: { lt: alertCutoff } },
      }),
      prisma.logEntry.count({
        where: { timestamp: { lt: logCutoff } },
      }),
    ]);

    logger.info('[DataCleanup] Records to cleanup', {
      incidents: incidentsToDelete,
      alerts: alertsToDelete,
      logs: logsToDelete,
      cutoffs: {
        incident: incidentCutoff.toISOString(),
        alert: alertCutoff.toISOString(),
        log: logCutoff.toISOString(),
      },
    });

    if (dryRun) {
      return {
        incidents: incidentsToDelete,
        alerts: alertsToDelete,
        logs: logsToDelete,
        metrics: 0,
        events: 0,
        executionTimeMs: Date.now() - startTime,
        dryRun: true,
      };
    }

    // 2. Delete in order (events/notes first due to foreign keys)

    // Get incident IDs to delete
    const incidentIds = await prisma.incident.findMany({
      where: {
        createdAt: { lt: incidentCutoff },
        status: 'RESOLVED',
      },
      select: { id: true },
    });
    const idsToDelete = incidentIds.map(i => i.id);

    if (idsToDelete.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
        const batch = idsToDelete.slice(i, i + BATCH_SIZE);

        // Delete incident events
        const eventsDeleted = await prisma.incidentEvent.deleteMany({
          where: { incidentId: { in: batch } },
        });
        eventCount += eventsDeleted.count;

        // Delete incident notes
        await prisma.incidentNote.deleteMany({
          where: { incidentId: { in: batch } },
        });

        // Delete custom field values
        await prisma.customFieldValue.deleteMany({
          where: { incidentId: { in: batch } },
        });

        // Delete related notifications
        if (prisma.notification?.deleteMany) {
          await prisma.notification.deleteMany({
            where: { incidentId: { in: batch } },
          });
        }

        // Delete related alerts (set incidentId to null instead of deleting)
        await prisma.alert.updateMany({
          where: { incidentId: { in: batch } },
          data: { incidentId: null },
        });

        // Delete incidents
        const incidentsDeleted = await prisma.incident.deleteMany({
          where: { id: { in: batch } },
        });
        incidentCount += incidentsDeleted.count;
      }
    }

    // Delete old alerts (those not linked to incidents)
    const alertsDeleted = await prisma.alert.deleteMany({
      where: {
        createdAt: { lt: alertCutoff },
        incidentId: null,
      },
    });
    alertCount = alertsDeleted.count;

    // Delete old logs
    const logsDeleted = await prisma.logEntry.deleteMany({
      where: { timestamp: { lt: logCutoff } },
    });
    logCount = logsDeleted.count;

    // Cleanup old metric rollups (telemetry)
    metricsCount = await cleanupOldRollups();

    // Cleanup old SLA performance rollups
    const slaRollupsDeleted = await cleanupOldSLARollups();

    const executionTimeMs = Date.now() - startTime;

    logger.info('[DataCleanup] Cleanup completed', {
      incidents: incidentCount,
      events: eventCount,
      alerts: alertCount,
      logs: logCount,
      metrics: metricsCount,
      slaRollups: slaRollupsDeleted,
      executionTimeMs,
    });

    return {
      incidents: incidentCount,
      alerts: alertCount,
      logs: logCount,
      metrics: metricsCount,
      events: eventCount,
      executionTimeMs,
      dryRun: false,
    };
  } catch (error) {
    logger.error('[DataCleanup] Cleanup failed', { error });
    throw error;
  }
}

/**
 * Cleanup old SLA metric rollups based on retention policy
 */
export async function cleanupOldSLARollups(): Promise<number> {
  const { default: prisma } = await import('./prisma');
  const { acquireAdvisoryLock, LOCK_KEYS } = await import('./db-locks');
  const policy = await getRetentionPolicy();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - policy.metricsRetentionDays);

  try {
    // Acquire the rollup-write lock so a concurrent rollup generator
    // can't have a partial upsert killed mid-flight.
    const deletedCount = await prisma.$transaction(async tx => {
      await acquireAdvisoryLock(tx, LOCK_KEYS.ROLLUP_WRITE);
      const result = await tx.incidentMetricRollup.deleteMany({
        where: { date: { lt: cutoffDate } },
      });
      return result.count;
    });

    logger.info('[DataCleanup] Old SLA rollups deleted', {
      count: deletedCount,
      cutoffDate: cutoffDate.toISOString(),
      retentionDays: policy.metricsRetentionDays,
    });

    return deletedCount;
  } catch (error) {
    logger.error('[DataCleanup] Failed to cleanup old SLA rollups', { error });
    return 0;
  }
}

/**
 * Archive incidents to a separate table before deletion
 * For production use - preserves data for compliance
 */
export async function archiveOldIncidents(): Promise<number> {
  const { default: prisma } = await import('./prisma');
  const policy = await getRetentionPolicy();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - policy.incidentRetentionDays);

  // For now, just log what would be archived
  // In production, you'd move data to an archive table or cold storage
  const count = await prisma.incident.count({
    where: {
      createdAt: { lt: cutoff },
      status: 'RESOLVED',
    },
  });

  logger.info('[DataCleanup] Incidents ready for archival', {
    count,
    cutoff: cutoff.toISOString(),
  });

  return count;
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  incidents: { total: number; byStatus: Record<string, number>; oldest: Date | null };
  alerts: { total: number; oldest: Date | null };
  logs: { total: number; oldest: Date | null };
  rollups: { total: number; oldest: Date | null };
}> {
  const { default: prisma } = await import('./prisma');

  const [
    incidentTotal,
    incidentByStatus,
    oldestIncident,
    alertTotal,
    oldestAlert,
    logTotal,
    oldestLog,
    rollupTotal,
    oldestRollup,
  ] = await Promise.all([
    prisma.incident.count(),
    prisma.incident.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.incident.findFirst({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.alert.count(),
    prisma.alert.findFirst({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.logEntry.count(),
    prisma.logEntry.findFirst({
      select: { timestamp: true },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.incidentMetricRollup.count(),
    prisma.incidentMetricRollup.findFirst({
      select: { date: true },
      orderBy: { date: 'asc' },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const group of incidentByStatus) {
    statusCounts[group.status] = group._count._all;
  }

  return {
    incidents: {
      total: incidentTotal,
      byStatus: statusCounts,
      oldest: oldestIncident?.createdAt || null,
    },
    alerts: {
      total: alertTotal,
      oldest: oldestAlert?.createdAt || null,
    },
    logs: {
      total: logTotal,
      oldest: oldestLog?.timestamp || null,
    },
    rollups: {
      total: rollupTotal,
      oldest: oldestRollup?.date || null,
    },
  };
}
