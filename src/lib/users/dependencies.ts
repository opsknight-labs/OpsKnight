import 'server-only';

import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';

export type UserDependencyImpact = {
  teamMemberships: number;
  ownedTeams: number;
  escalationTargets: number;
  scheduleLayers: number;
  currentOrFutureOverrides: number;
  currentOrFutureShifts: number;
  activeIncidents: number;
  openActionItems: number;
  dashboards: number;
};

export async function discoverUserDependencies(userId: string): Promise<UserDependencyImpact> {
  const now = new Date();
  const [
    teamMemberships,
    ownedTeams,
    escalationTargets,
    scheduleLayers,
    currentOrFutureOverrides,
    currentOrFutureShifts,
    activeIncidents,
    openActionItems,
    dashboards,
  ] = await Promise.all([
    prisma.teamMember.count({ where: { userId } }),
    prisma.teamMember.count({ where: { userId, role: 'OWNER' } }),
    prisma.escalationRule.count({ where: { targetUserId: userId } }),
    prisma.onCallLayerUser.count({ where: { userId } }),
    prisma.onCallOverride.count({
      where: { OR: [{ userId }, { replacesUserId: userId }], end: { gte: now } },
    }),
    prisma.onCallShift.count({ where: { userId, end: { gte: now } } }),
    prisma.incident.count({
      where: { assigneeId: userId, status: { in: activeIncidentStatuses() } },
    }),
    prisma.actionItem.count({ where: { ownerId: userId, status: { not: 'COMPLETED' } } }),
    prisma.dashboard.count({ where: { userId } }),
  ]);

  return {
    teamMemberships,
    ownedTeams,
    escalationTargets,
    scheduleLayers,
    currentOrFutureOverrides,
    currentOrFutureShifts,
    activeIncidents,
    openActionItems,
    dashboards,
  };
}

export function dependencySummary(impact: UserDependencyImpact): string[] {
  return Object.entries(impact)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}: ${count}`);
}
