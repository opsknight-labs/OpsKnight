import prisma from '@/lib/prisma';
import { resolveEscalationTarget } from '@/lib/escalation/target-resolution';

const MAX_ON_CALL_RESPONDERS = 10;

/**
 * Who is on call right now for the schedules in the service's escalation policy. Opt-in via
 * ChatOpsConfig.warRoomInviteOnCall; off (or no schedule step) returns nobody.
 */
export async function resolveOnCallWarRoomResponders(serviceId: string): Promise<string[]> {
  const config = await prisma.chatOpsConfig.findUnique({
    where: { id: 'default' },
    select: { warRoomInviteOnCall: true },
  });
  if (!config?.warRoomInviteOnCall) return [];
  const rules = await prisma.escalationRule.findMany({
    where: { policy: { services: { some: { id: serviceId } } }, targetType: 'SCHEDULE' },
    select: { targetScheduleId: true },
    take: 20,
  });
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule.targetScheduleId) continue;
    for (const userId of await resolveEscalationTarget('SCHEDULE', rule.targetScheduleId)) {
      ids.add(userId);
    }
  }
  return [...ids].slice(0, MAX_ON_CALL_RESPONDERS);
}

const MAX_SERVICE_RESPONDERS = 25;

/**
 * People a service always adds to its war rooms: the owning team's members (all, or only owners and
 * admins) plus any named people, who need not belong to the team. Only active users, capped.
 */
export async function resolveServiceWarRoomResponders(serviceId: string): Promise<string[]> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { teamId: true, warRoomAutoAddTeam: true, warRoomAutoAddUserIds: true },
  });
  if (!service) return [];
  const ids = new Set<string>(service.warRoomAutoAddUserIds ?? []);
  if (service.teamId && service.warRoomAutoAddTeam !== 'NONE') {
    const members = await prisma.teamMember.findMany({
      where: {
        teamId: service.teamId,
        ...(service.warRoomAutoAddTeam === 'MANAGERS' ? { role: { in: ['OWNER', 'ADMIN'] } } : {}),
      },
      select: { userId: true },
      take: 200,
    });
    for (const member of members) ids.add(member.userId);
  }
  if (ids.size === 0) return [];
  const active = await prisma.user.findMany({
    where: { id: { in: [...ids] }, status: 'ACTIVE' },
    select: { id: true },
    take: MAX_SERVICE_RESPONDERS,
  });
  return active.map(user => user.id);
}
