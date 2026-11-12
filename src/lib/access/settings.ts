import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { DEFAULT_ACCESS_POLICY_SETTINGS, type AccessPolicySettings } from '@/lib/access/effective';

export type AccessControlSettings = AccessPolicySettings & {
  requestsEnabled: boolean;
  breakGlassEnabled: boolean;
  breakGlassMaxMinutes: number;
  selfApprovalAllowed: boolean;
  reviewIntervalDays: number | null;
  reviewLastStartedAt: Date | null;
};

export const DEFAULT_ACCESS_CONTROL_SETTINGS: AccessControlSettings = {
  ...DEFAULT_ACCESS_POLICY_SETTINGS,
  requestsEnabled: true,
  breakGlassEnabled: true,
  breakGlassMaxMinutes: 60,
  selfApprovalAllowed: false,
  reviewIntervalDays: null,
  reviewLastStartedAt: null,
};

/** Organization policy flags change rarely; a short process cache keeps checks cheap. */
const TTL_MS = 15_000;
let snapshot: { value: AccessControlSettings; loadedAt: number } | null = null;

export async function getAccessControlSettings(force = false): Promise<AccessControlSettings> {
  if (!force && snapshot && Date.now() - snapshot.loadedAt < TTL_MS) return snapshot.value;
  try {
    const row = await prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: {
        accessUserIncidentActionsEnabled: true,
        accessRequestsEnabled: true,
        accessBreakGlassEnabled: true,
        accessBreakGlassMaxMinutes: true,
        accessSelfApprovalAllowed: true,
        accessReviewIntervalDays: true,
        accessReviewLastStartedAt: true,
      },
    });
    const value: AccessControlSettings = row
      ? {
          userIncidentActionsEnabled: row.accessUserIncidentActionsEnabled,
          requestsEnabled: row.accessRequestsEnabled,
          breakGlassEnabled: row.accessBreakGlassEnabled,
          breakGlassMaxMinutes: row.accessBreakGlassMaxMinutes,
          selfApprovalAllowed: row.accessSelfApprovalAllowed,
          reviewIntervalDays: row.accessReviewIntervalDays,
          reviewLastStartedAt: row.accessReviewLastStartedAt,
        }
      : DEFAULT_ACCESS_CONTROL_SETTINGS;
    snapshot = { value, loadedAt: Date.now() };
    return value;
  } catch (error) {
    logger.warn('[Access] Could not load access-control settings; using last known values', {
      error,
    });
    return snapshot?.value ?? DEFAULT_ACCESS_CONTROL_SETTINGS;
  }
}

/**
 * Synchronous view for pure actor mapping. Callers that build actors should `await
 * getAccessControlSettings()` first; a stale value also triggers a background refresh so
 * long-lived API/ChatOps workers converge even without a page request.
 */
export function accessPolicySnapshot(): AccessPolicySettings {
  if (!snapshot || Date.now() - snapshot.loadedAt >= TTL_MS) void getAccessControlSettings();
  return snapshot?.value ?? DEFAULT_ACCESS_POLICY_SETTINGS;
}

/** Forces the next read to reload, keeping the last known value until it does. */
export function invalidateAccessControlSettings() {
  if (snapshot) snapshot = { value: snapshot.value, loadedAt: 0 };
}
