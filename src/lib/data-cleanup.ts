import 'server-only';
import type { Prisma } from '@prisma/client';
import { logger } from './logger';
import { getRetentionPolicy, type RetentionPolicy } from './retention-policy';
import { cleanupOldRollups } from './metric-rollup';
import {
  filterHeldIncidents,
  filterHeldPrivacyRequests,
  getHeldIncidentIds,
  getHeldPrivacyRequestIds,
} from './retention/lifecycle';
import { acquireRetentionResourceLock } from './retention/resource-lock';

export const CLEANUP_MUTEX_KEY = 'mutex:data-cleanup';
export const CLEANUP_MUTEX_LEASE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Acquires the distributed cleanup mutex lease on RateLimit.
 * Returns the version/fencing token (positive integer) if acquired, or null if another runner holds it.
 */
export async function acquireCleanupMutexLease(): Promise<number | null> {
  const { default: prisma } = await import('./prisma');
  if (!prisma) return null;
  const leaseExpiresAt = new Date(Date.now() + CLEANUP_MUTEX_LEASE_MS);
  const rows = await prisma.$queryRaw<Array<{ count?: number; acquired?: boolean }>>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${CLEANUP_MUTEX_KEY}, 1, ${leaseExpiresAt})
    ON CONFLICT ("key") DO UPDATE
    SET "count" = "RateLimit"."count" + 1, "expiresAt" = ${leaseExpiresAt}
    WHERE "RateLimit"."expiresAt" < NOW()
    RETURNING "count"
  `;
  if (!rows || rows.length === 0) {
    return null;
  }
  return typeof rows[0]?.count === 'number' ? rows[0].count : 1;
}

/**
 * Renews an active cleanup mutex lease for another lease duration,
 * only if the fencing token matches the current version in DB.
 */
export async function renewCleanupMutexLease(token: number): Promise<boolean> {
  const { default: prisma } = await import('./prisma');
  if (!prisma.$executeRaw) return false;
  const newExpiresAt = new Date(Date.now() + CLEANUP_MUTEX_LEASE_MS);
  const res = await prisma.$executeRaw`
    UPDATE "RateLimit"
    SET "expiresAt" = ${newExpiresAt}
    WHERE "key" = ${CLEANUP_MUTEX_KEY} AND "count" = ${token}
  `;
  return res > 0;
}

/**
 * Releases the cleanup mutex lease only if the fencing token matches.
 * Instead of deleting the row (which causes token wrap-around / ABA issues),
 * it marks the lease as expired (expiresAt in past) so future acquisitions
 * increment the version token monotonically.
 * If the lease expired and was claimed by another worker, this release safely does nothing.
 */
export async function releaseCleanupMutexLease(token: number): Promise<boolean> {
  const { default: prisma } = await import('./prisma');
  if (prisma.$executeRaw) {
    const res = await prisma.$executeRaw`
      UPDATE "RateLimit"
      SET "expiresAt" = NOW() - INTERVAL '1 second'
      WHERE "key" = ${CLEANUP_MUTEX_KEY} AND "count" = ${token}
    `;
    return res > 0;
  }
  if (prisma.rateLimit?.updateMany) {
    const res = await prisma.rateLimit.updateMany({
      where: { key: CLEANUP_MUTEX_KEY, count: token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    return res.count > 0;
  }
  return false;
}

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
  // Existing fields (unchanged for backwards compatibility)
  incidents: number;
  alerts: number;
  logs: number;
  metrics: number;
  events: number;
  auditLogs: number;
  inAppNotifications: number;
  slaPerformanceLogs: number;
  // New lifecycle fields (additive)
  held: {
    incidents: number;
    privacyRequests: number;
  };
  lifecycle: {
    privacyRequests: number;
    expiredExportArtifacts: number;
    unsubscribedSubscribers: number;
  };
  executionTimeMs: number;
  dryRun: boolean;
}

export class CleanupConflictError extends Error {
  readonly code = 'CLEANUP_CONFLICT';
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'CleanupConflictError';
  }
}

/** In-process single-flight lock to serialize cleanup mutations within this Node process */
let isCleanupInProgress = false;

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

  let leaseToken: number | null = null;
  if (!dryRun) {
    if (isCleanupInProgress) {
      throw new CleanupConflictError(
        'Data cleanup is already in progress. Please wait for the current run to complete.'
      );
    }
    isCleanupInProgress = true;
    try {
      leaseToken = await acquireCleanupMutexLease();
      if (leaseToken === null) {
        throw new CleanupConflictError(
          'Data cleanup is currently being executed by another process or instance.'
        );
      }
    } catch (lockErr) {
      if (lockErr instanceof CleanupConflictError) {
        isCleanupInProgress = false;
        throw lockErr;
      }
      // Non-PostgreSQL environments (e.g. unit test mocks) safely fall back to in-process mutex
    }
  }

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

  // Lifecycle cutoffs (Phase 3 PR2)
  const privacyRequestCutoff = new Date(now);
  privacyRequestCutoff.setDate(
    privacyRequestCutoff.getDate() - policy.completedPrivacyRequestRetentionDays
  );

  const expiredArtifactCutoff = new Date(now);
  expiredArtifactCutoff.setDate(
    expiredArtifactCutoff.getDate() - policy.expiredPrivacyArtifactRetentionDays
  );

  const subscriberCutoff = new Date(now);
  subscriberCutoff.setDate(subscriberCutoff.getDate() - policy.unsubscribedSubscriberRetentionDays);

  // Resolved incidents older than incidentCutoff that have had no event or note activity
  // since the incident retention cutoff. Also guard resolvedAt if set.
  const resolvedIncidentCleanupWhere = {
    createdAt: { lt: incidentCutoff },
    status: 'RESOLVED' as const,
    OR: [{ resolvedAt: { lt: incidentCutoff } }, { resolvedAt: null }],
    events: { none: { createdAt: { gte: incidentCutoff } } },
    notes: { none: { createdAt: { gte: incidentCutoff } } },
  };

  let incidentCount = 0;
  let alertCount = 0;
  let logCount = 0;
  let metricsCount = 0;
  let eventCount = 0;
  let auditLogCount = 0;
  let inAppNotificationCount = 0;
  let slaPerformanceLogCount = 0;
  let privacyRequestCount = 0;
  let expiredExportArtifactCount = 0;
  let unsubscribedSubscriberCount = 0;
  let heldIncidentCount = 0;
  let heldPrivacyRequestCount = 0;

  try {
    // Fetch active held IDs first for hold-aware candidate discovery and standalone exclusions
    const [allHeldIncidentIds, allHeldPrivacyRequestIds] = await Promise.all([
      getHeldIncidentIds(prisma),
      getHeldPrivacyRequestIds(prisma),
    ]);

    // 1. Find all eligible IDs first, then filter out held resources
    const [
      eligibleIncidents,
      eligiblePrivacyRequests,
      eligibleExportArtifacts,
      eligibleSubscribers,
    ] = await Promise.all([
      prisma.incident.findMany({
        where: resolvedIncidentCleanupWhere,
        select: { id: true },
      }),
      prisma.privacyRequest.findMany({
        where: {
          status: { in: ['COMPLETED', 'REJECTED'] },
          updatedAt: { lt: privacyRequestCutoff },
          // Do not delete parent requests if child export artifacts are still within artifact retention window
          exportArtifacts: {
            none: {
              OR: [{ status: { not: 'EXPIRED' } }, { expiresAt: { gte: expiredArtifactCutoff } }],
            },
          },
        },
        select: { id: true },
      }),
      prisma.privacyExportArtifact.findMany({
        where: {
          status: 'EXPIRED',
          expiresAt: { lt: expiredArtifactCutoff },
          // Exclude artifacts belonging to actively held privacy requests
          ...(allHeldPrivacyRequestIds.length > 0
            ? { requestId: { notIn: allHeldPrivacyRequestIds } }
            : {}),
        },
        select: { id: true },
      }),
      prisma.statusPageSubscription.findMany({
        where: {
          state: 'UNSUBSCRIBED',
          unsubscribedAt: { lt: subscriberCutoff },
        },
        select: { id: true },
      }),
    ]);

    const eligibleIncidentIds = eligibleIncidents.map(i => i.id);
    const eligiblePrivacyRequestIds = eligiblePrivacyRequests.map(r => r.id);

    // Filter out held resources
    const { deletableIds: deletableIncidents, heldCount: heldIncidents } =
      await filterHeldIncidents(prisma, eligibleIncidentIds);
    heldIncidentCount = heldIncidents;

    const { deletableIds: deletablePrivacyRequests, heldCount: heldPrivacyRequests } =
      await filterHeldPrivacyRequests(prisma, eligiblePrivacyRequestIds);
    heldPrivacyRequestCount = heldPrivacyRequests;

    // Count what would be deleted
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
      Promise.resolve(deletableIncidents.length),
      prisma.alert.count({
        where: {
          createdAt: { lt: alertCutoff },
          ...(allHeldIncidentIds.length > 0
            ? {
                OR: [{ incidentId: null }, { incidentId: { notIn: allHeldIncidentIds } }],
              }
            : {}),
        },
      }),
      prisma.logEntry.count({
        where: { timestamp: { lt: logCutoff } },
      }),
      prisma.incidentEvent.count({
        where: {
          createdAt: { lt: logCutoff },
          ...(allHeldIncidentIds.length > 0 ? { incidentId: { notIn: allHeldIncidentIds } } : {}),
        },
      }),
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
          incidentId: { in: deletableIncidents },
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
        held: {
          incidents: heldIncidentCount,
          privacyRequests: heldPrivacyRequestCount,
        },
        lifecycle: {
          privacyRequests: deletablePrivacyRequests.length,
          expiredExportArtifacts: eligibleExportArtifacts.length,
          unsubscribedSubscribers: eligibleSubscribers.length,
        },
        executionTimeMs: Date.now() - startTime,
        dryRun: true,
      };
    }

    // Helper to renew mutex lease and immediately abort with ConflictError if lease was lost
    const assertLeaseOwnership = async () => {
      if (leaseToken !== null) {
        const renewed = await renewCleanupMutexLease(leaseToken);
        if (!renewed) {
          throw new CleanupConflictError('Data cleanup lease ownership was lost.');
        }
      }
    };

    // 2. Delete in order with strict FK dependency ordering
    // Use pre-filtered deletable incidents to respect retention holds
    const BATCH_SIZE = 500;
    for (let i = 0; i < deletableIncidents.length; i += BATCH_SIZE) {
      const batch = deletableIncidents.slice(i, i + BATCH_SIZE);
      if (batch.length === 0) break;

      // Fence every destructive batch before it runs (including the very first batch)
      await assertLeaseOwnership();

      // Deterministically sort resource IDs before acquiring locks to prevent deadlocks
      const sortedBatch = [...batch].sort();

      let deletedBatchCount = 0;
      let batchFullyHeld = false;
      await prisma.$transaction(
        async tx => {
          // Acquire resource locks for all incidents in this batch (deterministic sorted order)
          for (const incidentId of sortedBatch) {
            await acquireRetentionResourceLock(tx, 'INCIDENT', incidentId);
          }

          // RE-CHECK active holds INSIDE this same transaction after acquiring the locks
          const { deletableIds: stillDeletableIncidents, heldCount: newlyHeld } =
            await filterHeldIncidents(tx, sortedBatch);

          if (newlyHeld > 0) {
            heldIncidentCount += newlyHeld;
            // Retain newly held IDs so subsequent child evidence phases exclude them and do not double-count
            const stillDeletableSet = new Set(stillDeletableIncidents);
            for (const id of sortedBatch) {
              if (!stillDeletableSet.has(id) && !allHeldIncidentIds.includes(id)) {
                allHeldIncidentIds.push(id);
              }
            }
          }

          if (stillDeletableIncidents.length === 0) {
            // All incidents in this batch became held
            batchFullyHeld = true;
            return;
          }

          const targetBatch = stillDeletableIncidents;

          // 2.1 Delete external issue links
          if (tx.externalIssueLink?.deleteMany) {
            await tx.externalIssueLink.deleteMany({
              where: {
                OR: [
                  { incidentId: { in: targetBatch } },
                  { actionItem: { incidentId: { in: targetBatch } } },
                ],
              },
            });
          }

          // 2.2 Delete action items
          if (tx.actionItem?.deleteMany) {
            await tx.actionItem.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.3 Delete postmortems
          if (tx.postmortem?.deleteMany) {
            await tx.postmortem.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.4 Delete incident watchers & tags
          if (tx.incidentWatcher?.deleteMany) {
            await tx.incidentWatcher.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }
          if (tx.incidentTag?.deleteMany) {
            await tx.incidentTag.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.5 Delete SLA pauses
          if (tx.incidentSlaPause?.deleteMany) {
            await tx.incidentSlaPause.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.6 Delete Slack pinned messages
          if (tx.slackPinnedMessage?.deleteMany) {
            await tx.slackPinnedMessage.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.7 Unlink status page announcements
          if (tx.statusPageAnnouncement?.updateMany) {
            await tx.statusPageAnnouncement.updateMany({
              where: { incidentId: { in: targetBatch } },
              data: { incidentId: null },
            });
          }

          // 2.8 Delete external operations referencing incidents
          if (tx.externalOperation?.deleteMany) {
            await tx.externalOperation.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.9 Delete notification delivery attempts and notifications
          if (tx.notificationDeliveryAttempt?.deleteMany) {
            await tx.notificationDeliveryAttempt.deleteMany({
              where: { notification: { incidentId: { in: targetBatch } } },
            });
          }
          if (tx.notification?.deleteMany) {
            await tx.notification.deleteMany({
              where: { incidentId: { in: targetBatch } },
            });
          }

          // 2.10 Delete incident events
          const eventsDeleted = await tx.incidentEvent.deleteMany({
            where: { incidentId: { in: targetBatch } },
          });
          eventCount += eventsDeleted.count;

          // 2.11 Delete incident notes
          await tx.incidentNote.deleteMany({
            where: { incidentId: { in: targetBatch } },
          });

          // 2.12 Delete custom field values
          await tx.customFieldValue.deleteMany({
            where: { incidentId: { in: targetBatch } },
          });

          // 2.13 Unlink alerts (set incidentId to null)
          await tx.alert.updateMany({
            where: { incidentId: { in: targetBatch } },
            data: { incidentId: null },
          });

          // 2.14 Delete incidents
          const incidentsDeleted = await tx.incident.deleteMany({
            where: { id: { in: targetBatch } },
          });
          incidentCount += incidentsDeleted.count;
          deletedBatchCount = incidentsDeleted.count;
        },
        {
          maxWait: 10000,
          timeout: 60000,
        }
      );

      if (batchFullyHeld) {
        await assertLeaseOwnership();
        continue;
      }

      // Loop termination safety guard against infinite loops
      if (deletedBatchCount === 0) {
        logger.warn('[DataCleanup] Batch incident delete returned 0 rows, stopping batch loop', {
          batchCount: batch.length,
        });
        break;
      }

      await assertLeaseOwnership();
    }

    // 3. Lifecycle cleanup: Privacy Requests (COMPLETED/REJECTED)
    if (deletablePrivacyRequests.length > 0) {
      for (let i = 0; i < deletablePrivacyRequests.length; i += BATCH_SIZE) {
        const batch = deletablePrivacyRequests.slice(i, i + BATCH_SIZE);
        if (batch.length === 0) break;

        // Fence every privacy request batch before it runs
        await assertLeaseOwnership();

        const sortedBatch = [...batch].sort();

        let prBatchFullyHeld = false;
        let prDeletedCount = 0;

        await prisma.$transaction(
          async tx => {
            // Acquire resource locks for all privacy requests in this batch in deterministic sorted order
            for (const requestId of sortedBatch) {
              await acquireRetentionResourceLock(tx, 'PRIVACY_REQUEST', requestId);
            }

            // RE-CHECK active holds INSIDE the transaction after acquiring locks
            const { deletableIds: stillDeletableRequests, heldCount: newlyHeld } =
              await filterHeldPrivacyRequests(tx, sortedBatch);

            if (newlyHeld > 0) {
              heldPrivacyRequestCount += newlyHeld;
              // Retain newly held IDs so subsequent child phases exclude them and do not double-count
              const stillDeletableSet = new Set(stillDeletableRequests);
              for (const id of sortedBatch) {
                if (!stillDeletableSet.has(id) && !allHeldPrivacyRequestIds.includes(id)) {
                  allHeldPrivacyRequestIds.push(id);
                }
              }
            }

            if (stillDeletableRequests.length === 0) {
              prBatchFullyHeld = true;
              return;
            }

            const deleted = await tx.privacyRequest.deleteMany({
              where: { id: { in: stillDeletableRequests } },
            });
            privacyRequestCount += deleted.count;
            prDeletedCount = deleted.count;
          },
          {
            maxWait: 10000,
            timeout: 60000,
          }
        );

        if (prBatchFullyHeld) {
          await assertLeaseOwnership();
          continue;
        }

        if (prDeletedCount === 0) {
          logger.warn(
            '[DataCleanup] Batch privacy request delete returned 0 rows, stopping batch loop',
            {
              batchCount: batch.length,
            }
          );
          break;
        }

        await assertLeaseOwnership();
      }
    }

    interface ChildRecordWithParent {
      id: string;
      parentId: string | null;
    }

    /**
     * Executes parent-hold-aware child deletion in batches:
     * 1. Fetches candidate child records with their parent resource IDs (excluding known held parents).
     * 2. Within a transaction:
     *    - Deterministically sorts unique non-null parent IDs.
     *    - Acquires transaction-scoped retention resource locks on parents.
     *    - Re-checks active holds on parents inside tx.
     *    - Deletes child records only for unheld (or null) parents.
     * 3. Records newly discovered held parents so subsequent batches and subsequent steps skip them.
     */
    const deleteChildrenWithParentHoldLock = async (
      resourceType: 'INCIDENT' | 'PRIVACY_REQUEST',
      initialHeldParentIds: string[],
      fetchCandidates: (excludedParentIds: string[]) => Promise<ChildRecordWithParent[]>,
      deleteBatch: (
        tx: Prisma.TransactionClient,
        deletableIds: string[]
      ) => Promise<{ count: number }>
    ): Promise<{ deletedCount: number; newlyDiscoveredHeldParentIds: string[] }> => {
      const knownHeldParentIds = new Set<string>(initialHeldParentIds);
      const newlyDiscovered = new Set<string>();
      let totalDeleted = 0;

      while (true) {
        await assertLeaseOwnership();
        const candidates = await fetchCandidates(Array.from(knownHeldParentIds));
        if (!candidates || candidates.length === 0) {
          break;
        }

        const uniqueParentIds = Array.from(
          new Set(
            candidates
              .map(c => c.parentId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        ).sort();

        let deletedInBatch = 0;
        let newlyHeldInBatch = 0;

        await prisma.$transaction(
          async tx => {
            let unheldParentIdsSet: Set<string>;

            if (uniqueParentIds.length > 0) {
              for (const parentId of uniqueParentIds) {
                await acquireRetentionResourceLock(tx, resourceType, parentId);
              }

              const { deletableIds } =
                resourceType === 'INCIDENT'
                  ? await filterHeldIncidents(tx, uniqueParentIds)
                  : await filterHeldPrivacyRequests(tx, uniqueParentIds);

              unheldParentIdsSet = new Set(deletableIds);

              for (const parentId of uniqueParentIds) {
                if (!unheldParentIdsSet.has(parentId)) {
                  if (!knownHeldParentIds.has(parentId)) {
                    knownHeldParentIds.add(parentId);
                    newlyDiscovered.add(parentId);
                    newlyHeldInBatch++;
                  }
                }
              }
            } else {
              unheldParentIdsSet = new Set<string>();
            }

            const deletableChildIds = candidates
              .filter(c => c.parentId === null || unheldParentIdsSet.has(c.parentId))
              .map(c => c.id);

            if (deletableChildIds.length > 0) {
              const res = await deleteBatch(tx, deletableChildIds);
              deletedInBatch = res?.count ?? 0;
              totalDeleted += deletedInBatch;
            }
          },
          {
            maxWait: 10000,
            timeout: 60000,
          }
        );

        if (deletedInBatch === 0 && newlyHeldInBatch === 0) {
          logger.warn('[DataCleanup] Child deletion batch made no progress, stopping loop', {
            candidateCount: candidates.length,
            resourceType,
          });
          break;
        }

        await assertLeaseOwnership();
      }

      return {
        deletedCount: totalDeleted,
        newlyDiscoveredHeldParentIds: Array.from(newlyDiscovered),
      };
    };

    // 4. Lifecycle cleanup: Expired Export Artifacts (lock & re-check parent PrivacyRequest)
    const { deletedCount: deletedArtifacts, newlyDiscoveredHeldParentIds: newlyHeldFromArtifacts } =
      await deleteChildrenWithParentHoldLock(
        'PRIVACY_REQUEST',
        allHeldPrivacyRequestIds,
        async excludedParentIds => {
          const rows = await prisma.privacyExportArtifact.findMany({
            where: {
              status: 'EXPIRED',
              expiresAt: { lt: expiredArtifactCutoff },
              ...(excludedParentIds.length > 0 ? { requestId: { notIn: excludedParentIds } } : {}),
            },
            select: { id: true, requestId: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
          });
          return rows.map(r => ({ id: r.id, parentId: r.requestId }));
        },
        (tx, ids) => tx.privacyExportArtifact.deleteMany({ where: { id: { in: ids } } })
      );
    expiredExportArtifactCount = deletedArtifacts;
    if (newlyHeldFromArtifacts.length > 0) {
      allHeldPrivacyRequestIds.push(...newlyHeldFromArtifacts);
      heldPrivacyRequestCount += newlyHeldFromArtifacts.length;
    }

    // 5. Lifecycle cleanup: Unsubscribed Subscribers
    if (eligibleSubscribers.length > 0) {
      for (let i = 0; i < eligibleSubscribers.length; i += BATCH_SIZE) {
        await assertLeaseOwnership();
        const batch = eligibleSubscribers.slice(i, i + BATCH_SIZE).map(s => s.id);
        const deleted = await prisma.statusPageSubscription.deleteMany({
          where: { id: { in: batch } },
        });
        unsubscribedSubscriberCount += deleted.count;
        await assertLeaseOwnership();
      }
    }

    const deleteInBatches = async (
      findIds: () => Promise<Array<{ id: string }>>,
      deleteIds: (ids: string[]) => Promise<{ count: number }>
    ) => {
      let deleted = 0;
      while (true) {
        await assertLeaseOwnership();
        const rows = await findIds();
        if (rows.length === 0) return deleted;
        const res = await deleteIds(rows.map(row => row.id));
        if (res.count === 0) {
          // Safety guard against infinite loop if rows cannot be deleted
          break;
        }
        deleted += res.count;
        await assertLeaseOwnership();
      }
      return deleted;
    };

    const { deletedCount: deletedAlerts, newlyDiscoveredHeldParentIds: newlyHeldFromAlerts } =
      await deleteChildrenWithParentHoldLock(
        'INCIDENT',
        allHeldIncidentIds,
        async excludedParentIds => {
          const rows = await prisma.alert.findMany({
            where: {
              createdAt: { lt: alertCutoff },
              ...(excludedParentIds.length > 0
                ? {
                    OR: [{ incidentId: null }, { incidentId: { notIn: excludedParentIds } }],
                  }
                : {}),
            },
            select: { id: true, incidentId: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
          });
          return rows.map(r => ({
            id: r.id,
            parentId: (r as { incidentId?: string | null }).incidentId ?? null,
          }));
        },
        (tx, ids) => tx.alert.deleteMany({ where: { id: { in: ids } } })
      );
    alertCount = deletedAlerts;
    if (newlyHeldFromAlerts.length > 0) {
      allHeldIncidentIds.push(...newlyHeldFromAlerts);
      heldIncidentCount += newlyHeldFromAlerts.length;
    }

    type OptionalCleanupModels = {
      notificationDeliveryAttempt?: { deleteMany?: unknown };
      notification?: { deleteMany?: unknown };
      externalOperation?: { deleteMany?: unknown };
    };
    const optionalModels = prisma as unknown as OptionalCleanupModels;

    // Prune standalone / unlinked notifications older than alertCutoff
    if (
      Boolean(
        optionalModels.notificationDeliveryAttempt?.deleteMany &&
        optionalModels.notification?.deleteMany
      )
    ) {
      const { newlyDiscoveredHeldParentIds: newlyHeldFromNotifications } =
        await deleteChildrenWithParentHoldLock(
          'INCIDENT',
          allHeldIncidentIds,
          async excludedParentIds => {
            const rows = await prisma.notification.findMany({
              where: {
                createdAt: { lt: alertCutoff },
                ...(excludedParentIds.length > 0
                  ? {
                      OR: [{ incidentId: null }, { incidentId: { notIn: excludedParentIds } }],
                    }
                  : {}),
              },
              select: { id: true, incidentId: true },
              orderBy: { id: 'asc' },
              take: BATCH_SIZE,
            });
            return rows.map(r => ({
              id: r.id,
              parentId: (r as { incidentId?: string | null }).incidentId ?? null,
            }));
          },
          async (tx, ids) => {
            if (tx.notificationDeliveryAttempt?.deleteMany) {
              await tx.notificationDeliveryAttempt.deleteMany({
                where: { notificationId: { in: ids } },
              });
            }
            return tx.notification.deleteMany({ where: { id: { in: ids } } });
          }
        );
      if (newlyHeldFromNotifications.length > 0) {
        allHeldIncidentIds.push(...newlyHeldFromNotifications);
        heldIncidentCount += newlyHeldFromNotifications.length;
      }
    }

    // Prune completed/failed external operations older than logCutoff
    if (Boolean(optionalModels.externalOperation?.deleteMany)) {
      const { newlyDiscoveredHeldParentIds: newlyHeldFromOps } =
        await deleteChildrenWithParentHoldLock(
          'INCIDENT',
          allHeldIncidentIds,
          async excludedParentIds => {
            const rows = await prisma.externalOperation.findMany({
              where: {
                createdAt: { lt: logCutoff },
                status: { in: ['COMPLETED', 'FAILED'] },
                ...(excludedParentIds.length > 0
                  ? {
                      OR: [{ incidentId: null }, { incidentId: { notIn: excludedParentIds } }],
                    }
                  : {}),
              },
              select: { id: true, incidentId: true },
              orderBy: { id: 'asc' },
              take: BATCH_SIZE,
            });
            return rows.map(r => ({
              id: r.id,
              parentId: (r as { incidentId?: string | null }).incidentId ?? null,
            }));
          },
          (tx, ids) => tx.externalOperation.deleteMany({ where: { id: { in: ids } } })
        );
      if (newlyHeldFromOps.length > 0) {
        allHeldIncidentIds.push(...newlyHeldFromOps);
        heldIncidentCount += newlyHeldFromOps.length;
      }
    }

    const { deletedCount: deletedEvents, newlyDiscoveredHeldParentIds: newlyHeldFromEvents } =
      await deleteChildrenWithParentHoldLock(
        'INCIDENT',
        allHeldIncidentIds,
        async excludedParentIds => {
          const rows = await prisma.incidentEvent.findMany({
            where: {
              createdAt: { lt: logCutoff },
              ...(excludedParentIds.length > 0 ? { incidentId: { notIn: excludedParentIds } } : {}),
            },
            select: { id: true, incidentId: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
          });
          return rows.map(r => ({
            id: r.id,
            parentId: (r as { incidentId?: string | null }).incidentId ?? null,
          }));
        },
        (tx, ids) => tx.incidentEvent.deleteMany({ where: { id: { in: ids } } })
      );
    eventCount += deletedEvents;
    if (newlyHeldFromEvents.length > 0) {
      allHeldIncidentIds.push(...newlyHeldFromEvents);
      heldIncidentCount += newlyHeldFromEvents.length;
    }

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

    // Cleanup old metric rollups (with exact cutoff matching preview)
    metricsCount = await cleanupOldRollups(metricsCutoff);

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
      privacyRequests: privacyRequestCount,
      expiredExportArtifacts: expiredExportArtifactCount,
      unsubscribedSubscribers: unsubscribedSubscriberCount,
      heldIncidents: heldIncidentCount,
      heldPrivacyRequests: heldPrivacyRequestCount,
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
      held: {
        incidents: heldIncidentCount,
        privacyRequests: heldPrivacyRequestCount,
      },
      lifecycle: {
        privacyRequests: privacyRequestCount,
        expiredExportArtifacts: expiredExportArtifactCount,
        unsubscribedSubscribers: unsubscribedSubscriberCount,
      },
      executionTimeMs,
      dryRun: false,
    };
  } catch (error) {
    logger.error('[DataCleanup] Cleanup failed', { error });
    throw error;
  } finally {
    if (!dryRun) {
      isCleanupInProgress = false;
      if (leaseToken !== null) {
        try {
          await releaseCleanupMutexLease(leaseToken);
        } catch (_unlockErr) {
          // Ignore error on cleanup finish
        }
      }
    }
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
  inAppNotifications: { total: number; oldest: Date | null };
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
    inAppNotificationTotal,
    oldestInAppNotification,
  ] = await Promise.all([
    prisma.incident?.count ? prisma.incident.count() : Promise.resolve(0),
    prisma.incident?.groupBy
      ? prisma.incident.groupBy({
          by: ['status'],
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.incident?.findFirst
      ? prisma.incident.findFirst({
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve(null),
    prisma.alert?.count ? prisma.alert.count() : Promise.resolve(0),
    prisma.alert?.findFirst
      ? prisma.alert.findFirst({
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve(null),
    prisma.logEntry?.count ? prisma.logEntry.count() : Promise.resolve(0),
    prisma.logEntry?.findFirst
      ? prisma.logEntry.findFirst({
          select: { timestamp: true },
          orderBy: { timestamp: 'asc' },
        })
      : Promise.resolve(null),
    prisma.auditLog?.count ? prisma.auditLog.count() : Promise.resolve(0),
    prisma.auditLog?.findFirst
      ? prisma.auditLog.findFirst({
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve(null),
    prisma.incidentMetricRollup?.count ? prisma.incidentMetricRollup.count() : Promise.resolve(0),
    prisma.incidentMetricRollup?.findFirst
      ? prisma.incidentMetricRollup.findFirst({
          select: { date: true },
          orderBy: { date: 'asc' },
        })
      : Promise.resolve(null),
    prisma.inAppNotification?.count ? prisma.inAppNotification.count() : Promise.resolve(0),
    prisma.inAppNotification?.findFirst
      ? prisma.inAppNotification.findFirst({
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve(null),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const group of incidentByStatus || []) {
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
    inAppNotifications: {
      total: inAppNotificationTotal,
      oldest: oldestInAppNotification?.createdAt || null,
    },
    rollups: {
      total: rollupTotal,
      oldest: oldestRollup?.date || null,
    },
  };
}
