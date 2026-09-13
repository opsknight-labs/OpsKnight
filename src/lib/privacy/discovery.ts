import 'server-only';

import { z } from 'zod';
import { emitAuditEvent } from '@/lib/audit';
import prisma from '@/lib/prisma';

export const subjectDiscoveryInputSchema = z.object({
  userId: z.string().cuid(),
  actorUserId: z.string().cuid(),
});

export type SubjectDiscoveryCounts = Awaited<ReturnType<typeof discoverSubjectData>>;

/**
 * Count records with an explicit user relation. This does not search free text,
 * email snapshots, JSON payloads, logs, status subscribers or external systems.
 */
export async function discoverSubjectData(input: unknown) {
  const { userId, actorUserId } = subjectDiscoveryInputSchema.parse(input);

  const [
    user,
    oidcIdentities,
    oidcLinkingApprovals,
    teamMemberships,
    assignedIncidents,
    incidentWatches,
    incidentNotes,
    postmortemsAuthored,
    actionItemsOwned,
    onCallLayerAssignments,
    onCallOverrides,
    onCallReplacementOverrides,
    onCallShifts,
    notifications,
    inAppNotifications,
    userDevices,
    auditEvents,
    userTokens,
    apiKeys,
    dashboards,
    integrationConfigurationsUpdated,
  ] = await Promise.all([
    prisma.user.count({ where: { id: userId } }),
    prisma.oidcIdentity.count({ where: { userId } }),
    prisma.oidcLinkingApproval.count({ where: { userId } }),
    prisma.teamMember.count({ where: { userId } }),
    prisma.incident.count({ where: { assigneeId: userId } }),
    prisma.incidentWatcher.count({ where: { userId } }),
    prisma.incidentNote.count({ where: { userId } }),
    prisma.postmortem.count({ where: { createdById: userId } }),
    prisma.actionItem.count({ where: { ownerId: userId } }),
    prisma.onCallLayerUser.count({ where: { userId } }),
    prisma.onCallOverride.count({ where: { userId } }),
    prisma.onCallOverride.count({ where: { replacesUserId: userId } }),
    prisma.onCallShift.count({ where: { userId } }),
    prisma.notification.count({ where: { userId } }),
    prisma.inAppNotification.count({ where: { userId } }),
    prisma.userDevice.count({ where: { userId } }),
    prisma.auditLog.count({
      where: { OR: [{ actorId: userId }, { entityType: 'USER', entityId: userId }] },
    }),
    prisma.userToken.count({ where: { userId } }),
    prisma.apiKey.count({ where: { userId } }),
    prisma.dashboard.count({ where: { userId } }),
    Promise.all([
      prisma.oidcConfig.count({ where: { updatedBy: userId } }),
      prisma.slackOAuthConfig.count({ where: { updatedBy: userId } }),
      prisma.jiraConfig.count({ where: { updatedBy: userId } }),
      prisma.notificationProvider.count({ where: { updatedBy: userId } }),
    ]).then(counts => counts.reduce((total, count) => total + count, 0)),
  ]);

  const counts = {
    user,
    oidcIdentities,
    oidcLinkingApprovals,
    teamMemberships,
    assignedIncidents,
    incidentWatches,
    incidentNotes,
    postmortemsAuthored,
    actionItemsOwned,
    onCallLayerAssignments,
    onCallOverrides,
    onCallReplacementOverrides,
    onCallShifts,
    notifications,
    inAppNotifications,
    userDevices,
    auditEvents,
    userTokens,
    apiKeys,
    dashboards,
    integrationConfigurationsUpdated,
  };
  const matchedCategories = Object.values(counts).filter(count => count > 0).length;
  const totalDirectRelations = Object.values(counts).reduce((total, count) => total + count, 0);

  // A compliance-sensitive lookup must not succeed without recording its actor
  // and subject. Subject email/name are deliberately absent from the event.
  await emitAuditEvent({
    action: 'privacy.subject_discovery.viewed',
    source: 'UI',
    target: { type: 'USER', id: userId },
    actor: { type: 'USER', id: actorUserId },
    metadata: {
      resultCategory: 'DIRECT_RELATION_COUNTS',
      matchedCategories,
      totalDirectRelations,
    },
  });

  return {
    subjectUserId: userId,
    generatedAt: new Date().toISOString(),
    counts,
    limitations: [
      'Counts identify direct database relations only; they are not a complete data-subject access result.',
      'Free text, email/name snapshots, IP addresses, JSON payloads and application or external logs are not searched.',
      'Status-page subscribers are not matched by email because they have no verified user relation.',
      'External identity, delivery, ChatOps and ticketing providers are not queried.',
      'A zero count does not prove absence of personal data, and this operation does not export, alter or delete records.',
    ],
  } as const;
}
