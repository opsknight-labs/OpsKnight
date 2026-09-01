import 'server-only';

import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';

export type UserDependencyReport = {
  teams: Array<{ membershipId: string; teamId: string; teamName: string; role: string }>;
  escalationPolicies: Array<{
    stepId: string;
    stepOrder: number;
    policyId: string;
    policyName: string;
  }>;
  scheduleLayers: Array<{
    assignmentId: string;
    layerId: string;
    layerName: string;
    scheduleId: string;
    scheduleName: string;
  }>;
  overrides: Array<{
    overrideId: string;
    scheduleId: string;
    scheduleName: string;
    relation: 'recipient' | 'replaced-user';
    start: Date;
    end: Date;
  }>;
  shifts: Array<{
    shiftId: string;
    scheduleId: string;
    scheduleName: string;
    start: Date;
    end: Date;
  }>;
  incidents: Array<{ incidentId: string; title: string; serviceId: string; serviceName: string }>;
  actionItems: Array<{ actionItemId: string; title: string; incidentId: string }>;
  dashboards: Array<{ dashboardId: string; name: string; visibility: string }>;
};

export async function discoverUserDependencies(userId: string): Promise<UserDependencyReport> {
  const now = new Date();
  const [teams, policies, layers, overrides, shifts, incidents, actionItems, dashboards] =
    await Promise.all([
      prisma.teamMember.findMany({
        where: { userId },
        select: { id: true, teamId: true, role: true, team: { select: { name: true } } },
      }),
      prisma.escalationRule.findMany({
        where: { targetUserId: userId },
        select: { id: true, stepOrder: true, policyId: true, policy: { select: { name: true } } },
      }),
      prisma.onCallLayerUser.findMany({
        where: { userId },
        select: {
          id: true,
          layerId: true,
          layer: { select: { name: true, schedule: { select: { id: true, name: true } } } },
        },
      }),
      prisma.onCallOverride.findMany({
        where: { OR: [{ userId }, { replacesUserId: userId }], end: { gte: now } },
        select: {
          id: true,
          userId: true,
          scheduleId: true,
          start: true,
          end: true,
          schedule: { select: { name: true } },
        },
        orderBy: { start: 'asc' },
      }),
      prisma.onCallShift.findMany({
        where: { userId, end: { gte: now } },
        select: {
          id: true,
          scheduleId: true,
          start: true,
          end: true,
          schedule: { select: { name: true } },
        },
        orderBy: { start: 'asc' },
      }),
      prisma.incident.findMany({
        where: { assigneeId: userId, status: { in: activeIncidentStatuses() } },
        select: { id: true, title: true, serviceId: true, service: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.actionItem.findMany({
        where: { ownerId: userId, status: { not: 'COMPLETED' } },
        select: { id: true, title: true, incidentId: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dashboard.findMany({
        where: { userId },
        select: { id: true, name: true, visibility: true },
        orderBy: { name: 'asc' },
      }),
    ]);

  return {
    teams: teams.map(x => ({
      membershipId: x.id,
      teamId: x.teamId,
      teamName: x.team.name,
      role: x.role,
    })),
    escalationPolicies: policies.map(x => ({
      stepId: x.id,
      stepOrder: x.stepOrder,
      policyId: x.policyId,
      policyName: x.policy.name,
    })),
    scheduleLayers: layers.map(x => ({
      assignmentId: x.id,
      layerId: x.layerId,
      layerName: x.layer.name,
      scheduleId: x.layer.schedule.id,
      scheduleName: x.layer.schedule.name,
    })),
    overrides: overrides.map(x => ({
      overrideId: x.id,
      scheduleId: x.scheduleId,
      scheduleName: x.schedule.name,
      relation: x.userId === userId ? 'recipient' : 'replaced-user',
      start: x.start,
      end: x.end,
    })),
    shifts: shifts.map(x => ({
      shiftId: x.id,
      scheduleId: x.scheduleId,
      scheduleName: x.schedule.name,
      start: x.start,
      end: x.end,
    })),
    incidents: incidents.map(x => ({
      incidentId: x.id,
      title: x.title,
      serviceId: x.serviceId,
      serviceName: x.service.name,
    })),
    actionItems: actionItems.map(x => ({
      actionItemId: x.id,
      title: x.title,
      incidentId: x.incidentId,
    })),
    dashboards: dashboards.map(x => ({
      dashboardId: x.id,
      name: x.name,
      visibility: x.visibility,
    })),
  };
}

export function dependencySummary(report: UserDependencyReport): string[] {
  return Object.entries(report)
    .filter(([, entries]) => entries.length > 0)
    .map(([kind, entries]) => `${kind}: ${entries.length}`);
}

export function hasBlockingUserDependencies(report: UserDependencyReport): boolean {
  return Object.values(report).some(entries => entries.length > 0);
}
