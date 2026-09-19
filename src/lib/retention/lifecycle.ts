import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { RetentionPolicy } from '@/lib/retention-policy';
import { isRetentionHeld } from './holds';

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
  if (!txOrPrisma?.dataRetentionHold?.findMany) {
    return { deletableIds: incidentIds, heldCount: 0 };
  }

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
  if (!txOrPrisma?.dataRetentionHold?.findMany) {
    return { deletableIds: requestIds, heldCount: 0 };
  }

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
  if (!txOrPrisma?.dataRetentionHold?.findMany) return [];

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
  if (!txOrPrisma?.dataRetentionHold?.findMany) return [];

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
 * Canonical non-destructive preview delegating to performDataCleanup(dryRun=true).
 */
export async function previewDataCleanupWithHolds(
  policyOverride?: Partial<RetentionPolicy>
): Promise<CleanupResultWithHolds> {
  const { performDataCleanup } = await import('@/lib/data-cleanup');
  const result = await performDataCleanup(true, policyOverride);
  return result as CleanupResultWithHolds;
}
