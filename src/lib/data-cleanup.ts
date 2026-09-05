import 'server-only';
import { logger } from './logger';
import { getRetentionPolicy, type RetentionPolicy } from './retention-policy';
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
  auditLogs: number;
  inAppNotifications: number;
  slaPerformanceLogs: number;
  executionTimeMs: number;
  dryRun: boolean;
}

/**
 * Performs data cleanup based on retention policy
 *
 * @param dryRun - If true, only logs what would be deleted without actually deleting
 * @param policyOverride - Optional retention policy overrides (useful for previewing unsaved form settings)
 */
export async function performDataCleanup(
  dryRun: boolean = false,
  policyOverride?: Partial<RetentionPolicy>
): Promise<CleanupResult> {
  const startTime = Date.now();
  const { default: prisma } = await import('./prisma');
  const basePolicy = await getRetentionPolicy();
  const policy: RetentionPolicy = policyOverride
    ? { ...basePolicy, ...policyOverride }
    : basePolicy;

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
  const metricsCutoff = new Date(now);
  metricsCutoff.setDate(metricsCutoff.getDate() - policy.metricsRetentionDays);

  // Resolved incidents older than incidentCutoff that have had no event activity
  // since the incident retention cutoff. Also guard resolvedAt if set.
  const resolvedIncidentCleanupWhere = {
    createdAt: { lt: incidentCutoff },
    status: 'RESOLVED' as const,
    OR: [{ resolvedAt: { lt: incidentCutoff } }, { resolvedAt: null }],
    events: { none: { createdAt: { gte: incidentCutoff } } },
  };

  let incidentCount = 0;
  let alertCount = 0;
  let logCount = 0;
  let metricsCount = 0;
  let eventCount = 0;
  let auditLogCount = 0;
  let inAppNotificationCount = 0;
  let slaPerformanceLogCount = 0;

  try {
    // 1. Count what would be deleted
    const [
      incidentsToDelete,
      alertsToDelete,
      logsToDelete,
      eventsToDelete,
      auditLogsToDelete,
      metricsToDelete,
      inAppNotificationsToDelete,
      slaPerformanceLogsToDelete,
      incidentEventsFromIncidents,
    ] = await Promise.all([
      prisma.incident.count({
        where: resolvedIncidentCleanupWhere,
      }),
      prisma.alert.count({
        where: { createdAt: { lt: alertCutoff } },
      }),
      prisma.logEntry.count({
        where: { timestamp: { lt: logCutoff } },
      }),
      prisma.incidentEvent.count({ where: { createdAt: { lt: logCutoff } } }),
      prisma.auditLog.count({ where: { createdAt: { lt: logCutoff } } }),
      prisma.incidentMetricRollup?.count
        ? prisma.incidentMetricRollup.count({ where: { date: { lt: metricsCutoff } } })
        : Promise.resolve(0),
      prisma.inAppNotification?.count
        ? prisma.inAppNotification.count({ where: { createdAt: { lt: logCutoff } } })
        : Promise.resolve(0),
      prisma.sLAPerformanceLog?.count
        ? prisma.sLAPerformanceLog.count({ where: { timestamp: { lt: metricsCutoff } } })
        : Promise.resolve(0),
      prisma.incidentEvent.count({
        where: {
          incident: resolvedIncidentCleanupWhere,
          createdAt: { gte: logCutoff },
        },
      }),
    ]);

    logger.info('[DataCleanup] Records to cleanup', {
      incidents: incidentsToDelete,
      alerts: alertsToDelete,
      logs: logsToDelete,
      events: eventsToDelete + incidentEventsFromIncidents,
      auditLogs: auditLogsToDelete,
      metrics: metricsToDelete,
      inAppNotifications: inAppNotificationsToDelete,
      slaPerformanceLogs: slaPerformanceLogsToDelete,
      cutoffs: {
        incident: incidentCutoff.toISOString(),
        alert: alertCutoff.toISOString(),
        log: logCutoff.toISOString(),
        metrics: metricsCutoff.toISOString(),
      },
    });

    if (dryRun) {
      return {
        incidents: incidentsToDelete,
        alerts: alertsToDelete,
        logs: logsToDelete,
        metrics: metricsToDelete,
        events: eventsToDelete + incidentEventsFromIncidents,
        auditLogs: auditLogsToDelete,
        inAppNotifications: inAppNotificationsToDelete,
        slaPerformanceLogs: slaPerformanceLogsToDelete,
        executionTimeMs: Date.now() - startTime,
        dryRun: true,
      };
    }

    // 2. Delete in order (events/notes first due to foreign keys)

    const BATCH_SIZE = 500;
    while (true) {
      const incidentIds = await prisma.incident.findMany({
        where: resolvedIncidentCleanupWhere,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      const batch = incidentIds.map(i => i.id);
      if (batch.length === 0) break;
      await prisma.$transaction(async tx => {
        // Delete incident events
        const eventsDeleted = await tx.incidentEvent.deleteMany({
          where: { incidentId: { in: batch } },
        });
        eventCount += eventsDeleted.count;

        // Delete incident notes
        await tx.incidentNote.deleteMany({
          where: { incidentId: { in: batch } },
        });

        // Delete custom field values
        await tx.customFieldValue.deleteMany({
          where: { incidentId: { in: batch } },
        });

        // Delete related notifications
        if (tx.notification?.deleteMany) {
          await tx.notification.deleteMany({
            where: { incidentId: { in: batch } },
          });
        }

        // Delete related alerts (set incidentId to null instead of deleting)
        await tx.alert.updateMany({
          where: { incidentId: { in: batch } },
          data: { incidentId: null },
        });

        // Delete incidents
        const incidentsDeleted = await tx.incident.deleteMany({
          where: { id: { in: batch } },
        });
        incidentCount += incidentsDeleted.count;
      });
    }

    const deleteInBatches = async (
      findIds: () => Promise<Array<{ id: string }>>,
      deleteIds: (ids: string[]) => Promise<{ count: number }>
    ) => {
      let deleted = 0;
      while (true) {
        const rows = await findIds();
        if (rows.length === 0) return deleted;
        deleted += (await deleteIds(rows.map(row => row.id))).count;
      }
    };

    alertCount = await deleteInBatches(
      () =>
        prisma.alert.findMany({
          // Prune all alerts older than the retention cutoff, regardless of incidentId.
          // The previous restriction (incidentId: null) incorrectly exempted attached alerts
          // from pruning, causing unbounded Alert table growth on high-volume streams.
          where: { createdAt: { lt: alertCutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        }),
      ids => prisma.alert.deleteMany({ where: { id: { in: ids } } })
    );
    eventCount += await deleteInBatches(
      () =>
        prisma.incidentEvent.findMany({
          where: { createdAt: { lt: logCutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        }),
      ids => prisma.incidentEvent.deleteMany({ where: { id: { in: ids } } })
    );
    auditLogCount = await deleteInBatches(
      () =>
        prisma.auditLog.findMany({
          where: { createdAt: { lt: logCutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        }),
      ids => prisma.auditLog.deleteMany({ where: { id: { in: ids } } })
    );
    logCount = await deleteInBatches(
      () =>
        prisma.logEntry.findMany({
          where: { timestamp: { lt: logCutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        }),
      ids => prisma.logEntry.deleteMany({ where: { id: { in: ids } } })
    );
    inAppNotificationCount = await deleteInBatches(
      () =>
        prisma.inAppNotification.findMany({
          where: { createdAt: { lt: logCutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        }),
      ids => prisma.inAppNotification.deleteMany({ where: { id: { in: ids } } })
    );
    slaPerformanceLogCount = await deleteInBatches(
      () =>
        prisma.sLAPerformanceLog.findMany({
          where: { timestamp: { lt: metricsCutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        }),
      ids => prisma.sLAPerformanceLog.deleteMany({ where: { id: { in: ids } } })
    );

    // Cleanup old metric rollups (telemetry)
    metricsCount = await cleanupOldRollups();

    const executionTimeMs = Date.now() - startTime;

    logger.info('[DataCleanup] Cleanup completed', {
      incidents: incidentCount,
      events: eventCount,
      auditLogs: auditLogCount,
      alerts: alertCount,
      logs: logCount,
      metrics: metricsCount,
      inAppNotifications: inAppNotificationCount,
      slaPerformanceLogs: slaPerformanceLogCount,
      executionTimeMs,
    });

    return {
      incidents: incidentCount,
      alerts: alertCount,
      logs: logCount,
      metrics: metricsCount,
      events: eventCount,
      auditLogs: auditLogCount,
      inAppNotifications: inAppNotificationCount,
      slaPerformanceLogs: slaPerformanceLogCount,
      executionTimeMs,
      dryRun: false,
    };
  } catch (error) {
    logger.error('[DataCleanup] Cleanup failed', { error });
    throw error;
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
  auditLogs: { total: number; oldest: Date | null };
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
    auditLogTotal,
    oldestAuditLog,
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
    prisma.auditLog.count(),
    prisma.auditLog.findFirst({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
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
    auditLogs: {
      total: auditLogTotal,
      oldest: oldestAuditLog?.createdAt || null,
    },
    rollups: {
      total: rollupTotal,
      oldest: oldestRollup?.date || null,
    },
  };
}
