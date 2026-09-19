import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getRetentionPolicy, type RetentionPolicy } from '@/lib/retention-policy';
import { isRetentionHeld, getActiveRetentionHolds } from './holds';
import { acquireRetentionResourceLock } from './resource-lock';

/**
 * Retention Lifecycle Integration
 *
 * Connects retention holds to the cleanup process and erasure engine.
 * Provides the central integration point for hold-aware operations.
 */

export interface CleanupCandidate {
  id: string;
  scopeType: 'INCIDENT' | 'PRIVACY_REQUEST' | 'STATUS_SUBSCRIBER';
  eligibleAt: Date;
}

export interface CleanupResultWithHolds {
  incidents: number;
  alerts: number;
  logs: number;
  metrics: number;
  events: number;
  auditLogs: number;
  inAppNotifications: number;
  slaPerformanceLogs: number;
  // New lifecycle fields
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

/**
 * Checks if an incident is protected by an active retention hold.
 * Used by cleanup to skip held incidents and their related data.
 */
export async function isIncidentHeld(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  incidentId: string
): Promise<boolean> {
  const { held } = await isRetentionHeld(txOrPrisma, 'INCIDENT', incidentId);
  return held;
}

/**
 * Checks if a privacy request is protected by an active retention hold.
 */
export async function isPrivacyRequestHeld(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  requestId: string
): Promise<boolean> {
  const { held } = await isRetentionHeld(txOrPrisma, 'PRIVACY_REQUEST', requestId);
  return held;
}

/**
 * Checks if a user (status subscriber) is protected by an active retention hold.
 * Note: STATUS_SUBSCRIBER uses the same USER scope type since they're User records.
 */
export async function isUserHeld(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  userId: string
): Promise<boolean> {
  const { held } = await isRetentionHeld(txOrPrisma, 'USER', userId);
  return held;
}

/**
 * Filters a list of incident IDs to exclude those with active holds.
 * Returns the deletable incident IDs and count of held incidents.
 */
export async function filterHeldIncidents(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  incidentIds: string[]
): Promise<{ deletableIds: string[]; heldCount: number }> {
  if (incidentIds.length === 0) return { deletableIds: [], heldCount: 0 };

  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where: {
      scopeType: 'INCIDENT',
      scopeId: { in: incidentIds },
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { scopeId: true },
  });

  const heldIds = new Set(holds.map(h => h.scopeId));
  const deletableIds = incidentIds.filter(id => !heldIds.has(id));

  return { deletableIds, heldCount: heldIds.size };
}

/**
 * Filters privacy request IDs to exclude those with active holds.
 */
export async function filterHeldPrivacyRequests(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  requestIds: string[]
): Promise<{ deletableIds: string[]; heldCount: number }> {
  if (requestIds.length === 0) return { deletableIds: [], heldCount: 0 };

  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where: {
      scopeType: 'PRIVACY_REQUEST',
      scopeId: { in: requestIds },
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { scopeId: true },
  });

  const heldIds = new Set(holds.map(h => h.scopeId));
  const deletableIds = requestIds.filter(id => !heldIds.has(id));

  return { deletableIds, heldCount: heldIds.size };
}

/**
 * Gets all incident IDs that are held and thus protected from cleanup.
 */
export async function getHeldIncidentIds(
  txOrPrisma: Prisma.TransactionClient | typeof prisma
): Promise<string[]> {
  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where: {
      scopeType: 'INCIDENT',
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { scopeId: true },
  });
  return holds.map(h => h.scopeId);
}

/**
 * Gets all privacy request IDs that are held.
 */
export async function getHeldPrivacyRequestIds(
  txOrPrisma: Prisma.TransactionClient | typeof prisma
): Promise<string[]> {
  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where: {
      scopeType: 'PRIVACY_REQUEST',
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { scopeId: true },
  });
  return holds.map(h => h.scopeId);
}

/**
 * Preview cleanup with hold awareness - returns what would be deleted vs held.
 */
export async function previewDataCleanupWithHolds(
  policyOverride?: Partial<RetentionPolicy>
): Promise<CleanupResultWithHolds> {
  const startTime = Date.now();
  const { default: prisma } = await import('@/lib/prisma');
  const basePolicy = await getRetentionPolicy();
  const policy: RetentionPolicy = policyOverride
    ? { ...basePolicy, ...policyOverride }
    : basePolicy;

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

  // Privacy request cutoff
  const privacyRequestCutoff = new Date(now);
  privacyRequestCutoff.setDate(
    privacyRequestCutoff.getDate() - policy.completedPrivacyRequestRetentionDays
  );

  // Expired export artifact cutoff
  const expiredArtifactCutoff = new Date(now);
  expiredArtifactCutoff.setDate(
    expiredArtifactCutoff.getDate() - policy.expiredPrivacyArtifactRetentionDays
  );

  // Unsubscribed subscriber cutoff
  const subscriberCutoff = new Date(now);
  subscriberCutoff.setDate(subscriberCutoff.getDate() - policy.unsubscribedSubscriberRetentionDays);

  // Resolved incidents older than incidentCutoff
  const resolvedIncidentCleanupWhere = {
    createdAt: { lt: incidentCutoff },
    status: 'RESOLVED' as const,
    OR: [{ resolvedAt: { lt: incidentCutoff } }, { resolvedAt: null }],
    events: { none: { createdAt: { gte: incidentCutoff } } },
    notes: { none: { createdAt: { gte: incidentCutoff } } },
  };

  // Find all eligible incident IDs
  const eligibleIncidents = await prisma.incident.findMany({
    where: resolvedIncidentCleanupWhere,
    select: { id: true },
  });
  const eligibleIncidentIds = eligibleIncidents.map(i => i.id);

  // Find eligible privacy requests (COMPLETED/REJECTED older than cutoff)
  const eligiblePrivacyRequests = await prisma.privacyRequest.findMany({
    where: {
      status: { in: ['COMPLETED', 'REJECTED'] },
      updatedAt: { lt: privacyRequestCutoff },
    },
    select: { id: true },
  });
  const eligiblePrivacyRequestIds = eligiblePrivacyRequests.map(r => r.id);

  // Find expired export artifacts (status EXPIRED older than cutoff)
  const eligibleExportArtifacts = await prisma.privacyExportArtifact.findMany({
    where: {
      status: 'EXPIRED',
      expiresAt: { lt: expiredArtifactCutoff },
    },
    select: { id: true },
  });

  // Find unsubscribed subscribers
  const eligibleSubscribers = await prisma.statusPageSubscription.findMany({
    where: {
      state: 'UNSUBSCRIBED',
      unsubscribedAt: { lt: subscriberCutoff },
    },
    select: { id: true },
  });

  // Check holds
  const { deletableIds: deletableIncidents, heldCount: heldIncidents } = await filterHeldIncidents(
    prisma,
    eligibleIncidentIds
  );

  const { deletableIds: deletablePrivacyRequests, heldCount: heldPrivacyRequests } =
    await filterHeldPrivacyRequests(prisma, eligiblePrivacyRequestIds);

  const allHeldIncidentIds = await getHeldIncidentIds(prisma);

  // Count other eligible items
  const [
    alertsToDelete,
    eventsToDelete,
    incidentEventsFromIncidents,
    auditLogsToDelete,
    inAppNotificationsToDelete,
    slaPerformanceLogsToDelete,
  ] = await Promise.all([
    prisma.alert.count({ where: { createdAt: { lt: alertCutoff } } }),
    prisma.incidentEvent.count({
      where: {
        createdAt: { lt: logCutoff },
        ...(allHeldIncidentIds.length > 0 ? { incidentId: { notIn: allHeldIncidentIds } } : {}),
      },
    }),
    prisma.incidentEvent.count({
      where: {
        incidentId: { in: deletableIncidents },
        createdAt: { gte: logCutoff },
      },
    }),
    prisma.auditLog.count({ where: { createdAt: { lt: logCutoff } } }),
    prisma.inAppNotification?.count
      ? prisma.inAppNotification.count({ where: { createdAt: { lt: logCutoff } } })
      : Promise.resolve(0),
    prisma.sLAPerformanceLog?.count
      ? prisma.sLAPerformanceLog.count({ where: { timestamp: { lt: metricsCutoff } } })
      : Promise.resolve(0),
  ]);

  // Count metrics rollups
  const { cleanupOldRollups } = await import('@/lib/metric-rollup');
  const metricsToDelete = await cleanupOldRollups(metricsCutoff);

  return {
    incidents: deletableIncidents.length,
    alerts: alertsToDelete,
    logs: 0, // logCount will be calculated in actual cleanup
    metrics: metricsToDelete,
    events: eventsToDelete + incidentEventsFromIncidents,
    auditLogs: auditLogsToDelete,
    inAppNotifications: inAppNotificationsToDelete,
    slaPerformanceLogs: slaPerformanceLogsToDelete,
    held: {
      incidents: heldIncidents,
      privacyRequests: heldPrivacyRequests,
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
