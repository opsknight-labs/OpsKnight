import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { discoverUserDependencies, type UserDependencyReport } from '@/lib/users/dependencies';
import { assertUserIsNotSoleOwner, assertNotLastAdmin } from '@/app/(app)/users/actions';
import { isRetentionHeld } from '@/lib/retention/holds';

/**
 * Per-domain row counts for a subject, keyed by the domain ids in
 * src/lib/privacy/erasure/policy.ts. Used for both the plan preview and the
 * post-execution result summary (never contains PII — counts only).
 */
export type ErasureDomainCounts = Record<string, number>;

export interface SubjectErasureDiscovery {
  subjectId: string;
  email: string | null;
  domainCounts: ErasureDomainCounts;
  dependencyReport: UserDependencyReport;
  blockingConditions: string[];
}

/**
 * Read-only wrapper around assertUserIsNotSoleOwner/assertNotLastAdmin that
 * turns their thrown errors into blocking-condition strings instead of
 * propagating exceptions. Reusing these functions (rather than reimplementing
 * the checks) guarantees erasure can never diverge from ordinary account
 * deletion's last-admin/sole-owner invariants.
 */
async function collectAdminInvariantBlockers(userId: string): Promise<string[]> {
  const blockers: string[] = [];
  try {
    await assertUserIsNotSoleOwner(userId);
  } catch (error) {
    blockers.push(
      error instanceof Error ? error.message : 'Sole team ownership must be reassigned first.'
    );
  }
  try {
    await assertNotLastAdmin(userId);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : 'Cannot erase the last active admin.');
  }
  return blockers;
}

/**
 * Blocking conditions derived from UserDependencyReport. Note this
 * deliberately does NOT use hasBlockingUserDependencies()/dependencySummary()
 * wholesale — those treat every non-empty category (including team
 * membership and personal dashboards, which erasure simply deletes) as
 * blocking. Erasure only blocks on categories the erasure policy classifies
 * as `blocking: true` in policy.ts (active rotations, active
 * overrides/escalation ownership, open action items, active incident
 * assignment, active/future on-call shifts) — everything else is handled
 * automatically by execute().
 */
function collectDependencyBlockers(report: UserDependencyReport): string[] {
  const blockers: string[] = [];
  if (report.scheduleLayers.length > 0) {
    blockers.push(`Still assigned to ${report.scheduleLayers.length} on-call rotation layer(s).`);
  }
  if (report.shifts.length > 0) {
    // discoverUserDependencies() already filters these to end >= now — a
    // materialized current/future shift must be reassigned first, or
    // erasure would delete it out from under live coverage.
    blockers.push(`Assigned to ${report.shifts.length} active/future on-call shift(s).`);
  }
  if (report.overrides.length > 0) {
    blockers.push(`Referenced by ${report.overrides.length} active/future on-call override(s).`);
  }
  if (report.escalationPolicies.length > 0) {
    blockers.push(
      `Still targeted by ${report.escalationPolicies.length} escalation policy step(s).`
    );
  }
  if (report.actionItems.length > 0) {
    blockers.push(`Owns ${report.actionItems.length} open postmortem action item(s).`);
  }
  if (report.incidents.length > 0) {
    blockers.push(`Assigned to ${report.incidents.length} active incident(s).`);
  }
  return blockers;
}

/**
 * Transaction-scoped revalidation of every destructive blocker. Called inside
 * the SERIALIZABLE destructive transaction in execute.ts after advisory locks
 * have been acquired but before any scrub/delete. Reuses the exact same
 * invariant logic (assertNotLastAdmin, assertUserIsNotSoleOwner) against `tx`
 * so concurrent mutations between the preview and the destructive tx are caught.
 *
 * Returns the same blocking-condition strings that buildSubjectErasurePlan()
 * would surface, so the execute() caller can present identical guidance.
 */
export async function discoverErasureBlockersTx(
  tx: Prisma.TransactionClient,
  subjectId: string
): Promise<string[]> {
  const blockers: string[] = [];

  // --- Retention hold check ---
  const { held: isHeld } = await isRetentionHeld(tx, 'USER', subjectId);
  if (isHeld) {
    blockers.push('Subject is protected by an active retention hold.');
  }

  // --- Admin invariants: last-admin + sole-owner ---
  // Mirrors src/app/(app)/users/actions.ts:assertUserIsNotSoleOwner +
  // assertNotLastAdmin, read against the same SERIALIZABLE snapshot that
  // will delete the user.
  const user = await tx.user.findUnique({
    where: { id: subjectId },
    select: { role: true, status: true },
  });

  const ownedMemberships = await tx.teamMember.findMany({
    where: { userId: subjectId, role: 'OWNER' },
    select: { teamId: true },
  });
  if (ownedMemberships.length > 0) {
    const teamIds = ownedMemberships.map(m => m.teamId);
    const ownerCounts = await tx.teamMember.groupBy({
      by: ['teamId'],
      where: { teamId: { in: teamIds }, role: 'OWNER' },
      _count: { _all: true },
    });
    const soleOwnerTeamIds = ownerCounts
      .filter(entry => entry._count._all === 1)
      .map(entry => entry.teamId);
    if (soleOwnerTeamIds.length > 0) {
      blockers.push('Reassign team ownership before deleting this user.');
    }
  }

  if (user?.role === 'ADMIN' && user.status === 'ACTIVE') {
    const adminCount = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE' },
    });
    if (adminCount <= 1) {
      blockers.push('Cannot delete the last admin user. Create another admin first.');
    }
  }

  // --- Dependency blockers: active/future scheduling + incident coverage ---
  const now = new Date();
  const [layers, shifts, overrides, escalationSteps, openActionItems, activeIncidents] =
    await Promise.all([
      tx.onCallLayerUser.count({ where: { userId: subjectId } }),
      tx.onCallShift.count({ where: { userId: subjectId, end: { gte: now } } }),
      tx.onCallOverride.count({
        where: { OR: [{ userId: subjectId }, { replacesUserId: subjectId }], end: { gte: now } },
      }),
      tx.escalationRule.count({ where: { targetUserId: subjectId } }),
      tx.actionItem.count({ where: { ownerId: subjectId, status: { not: 'COMPLETED' } } }),
      tx.incident.count({
        where: { assigneeId: subjectId, status: { in: activeIncidentStatuses() } },
      }),
    ]);

  if (layers > 0) blockers.push(`Still assigned to ${layers} on-call rotation layer(s).`);
  if (shifts > 0) blockers.push(`Assigned to ${shifts} active/future on-call shift(s).`);
  if (overrides > 0) blockers.push(`Referenced by ${overrides} active/future on-call override(s).`);
  if (escalationSteps > 0)
    blockers.push(`Still targeted by ${escalationSteps} escalation policy step(s).`);
  if (openActionItems > 0) blockers.push(`Owns ${openActionItems} open postmortem action item(s).`);
  if (activeIncidents > 0) blockers.push(`Assigned to ${activeIncidents} active incident(s).`);

  return blockers;
}

/**
 * Gathers everything needed to build (or re-validate) an erasure plan: raw
 * domain counts for every policy.ts domain, the shared dependency report, and
 * the resolved list of blocking conditions.
 */
export async function discoverSubjectErasureData(
  subjectId: string
): Promise<SubjectErasureDiscovery> {
  const user = await prisma.user.findUnique({
    where: { id: subjectId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error(`No user exists with id ${subjectId}.`);
  }

  const [
    dependencyReport,
    adminBlockers,
    oidcIdentities,
    oidcLinkingApproval,
    apiKeys,
    userDevices,
    userTokens,
    dashboards,
    teamMemberships,
    incidentWatchers,
    onCallShifts,
    incidentNotes,
    postmortemsAuthored,
    incidentTemplatesAuthored,
    actionItemsOwned,
    notifications,
    inAppNotifications,
    auditLogSnapshots,
    oidcConfigAttribution,
    slackIntegrationAttribution,
    slackOAuthConfigAttribution,
    notificationProviderAttribution,
    microsoftTeamsAttribution,
    retentionHoldStatus,
  ] = await Promise.all([
    discoverUserDependencies(subjectId),
    collectAdminInvariantBlockers(subjectId),
    prisma.oidcIdentity.count({ where: { userId: subjectId } }),
    prisma.oidcLinkingApproval.count({ where: { userId: subjectId } }),
    prisma.apiKey.count({ where: { userId: subjectId } }),
    prisma.userDevice.count({ where: { userId: subjectId } }),
    prisma.userToken.count({
      where: {
        OR: [
          { userId: subjectId },
          ...(user.email ? [{ identifier: user.email.toLowerCase() }] : []),
        ],
      },
    }),
    prisma.dashboard.count({ where: { userId: subjectId } }),
    prisma.teamMember.count({ where: { userId: subjectId } }),
    prisma.incidentWatcher.count({ where: { userId: subjectId } }),
    prisma.onCallShift.count({ where: { userId: subjectId } }),
    prisma.incidentNote.count({ where: { userId: subjectId } }),
    prisma.postmortem.count({ where: { createdById: subjectId } }),
    prisma.incidentTemplate.count({ where: { createdById: subjectId } }),
    prisma.actionItem.count({ where: { ownerId: subjectId } }),
    prisma.notification.count({ where: { userId: subjectId } }),
    prisma.inAppNotification.count({ where: { userId: subjectId } }),
    user.email
      ? prisma.auditLog.count({
          where: {
            OR: [
              { actorId: subjectId },
              { actorEmail: user.email.toLowerCase() },
              { targetEmail: user.email.toLowerCase() },
            ],
          },
        })
      : prisma.auditLog.count({ where: { actorId: subjectId } }),
    prisma.oidcConfig.count({ where: { updatedBy: subjectId } }),
    prisma.slackIntegration.count({ where: { installedBy: subjectId } }),
    prisma.slackOAuthConfig.count({ where: { updatedBy: subjectId } }),
    prisma.notificationProvider.count({ where: { updatedBy: subjectId } }),
    Promise.all([
      prisma.microsoftTeamsConfig.count({ where: { updatedBy: subjectId } }),
      prisma.microsoftTeamsInstallation.count({ where: { installedBy: subjectId } }),
      prisma.microsoftTeamsDestination.count({ where: { updatedBy: subjectId } }),
    ]).then(counts => counts.reduce((sum, count) => sum + count, 0)),
    isRetentionHeld(prisma, 'USER', subjectId),
  ]);

  const domainCounts: ErasureDomainCounts = {
    userProfile: 1,
    userAvatar: 0,
    oidcIdentities,
    oidcLinkingApproval,
    apiKeys,
    userDevices,
    userTokens,
    dashboards,
    teamMemberships,
    incidentWatchers,
    onCallShifts,
    onCallLayerAssignments: dependencyReport.scheduleLayers.length,
    onCallOverrides: dependencyReport.overrides.length,
    oidcConfigAttribution,
    slackIntegrationAttribution,
    slackOAuthConfigAttribution,
    notificationProviderAttribution,
    microsoftTeamsAttribution,
    teamLead: dependencyReport.teamsLed.length,
    incidentNotes,
    postmortemsAuthored,
    incidentTemplatesAuthored,
    actionItemsOwned,
    assignedIncidents: dependencyReport.incidents.length,
    escalationOwnership: dependencyReport.escalationPolicies.length,
    notifications,
    inAppNotifications,
    auditLogSnapshots,
    retentionHold: retentionHoldStatus.held ? retentionHoldStatus.activeHoldCount : 0,
  };

  const blockingConditions = [
    ...(retentionHoldStatus.held ? ['Subject is protected by an active retention hold.'] : []),
    ...adminBlockers,
    ...collectDependencyBlockers(dependencyReport),
  ];

  return {
    subjectId,
    email: user.email,
    domainCounts,
    dependencyReport,
    blockingConditions,
  };
}
