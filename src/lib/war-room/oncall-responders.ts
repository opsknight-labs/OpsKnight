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

/** Named people are limited where they are chosen (25); the cap here only bounds a very large team. */
const MAX_TEAM_RESPONDERS = 100;

/**
 * People a service always adds to its war rooms: the owning team's members (all, or only owners and
 * admins) plus any named people, who need not belong to the team. Only active users. Every named person
 * is kept; only the team-derived part is capped.
 */
export async function resolveServiceWarRoomResponders(serviceId: string): Promise<string[]> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { teamId: true, warRoomAutoAddTeam: true, warRoomAutoAddUserIds: true },
  });
  if (!service) return [];
  const named = service.warRoomAutoAddUserIds ?? [];
  const members =
    service.teamId && service.warRoomAutoAddTeam !== 'NONE'
      ? await prisma.teamMember.findMany({
          where: {
            teamId: service.teamId,
            ...(service.warRoomAutoAddTeam === 'MANAGERS'
              ? { role: { in: ['OWNER', 'ADMIN'] } }
              : {}),
          },
          select: { userId: true },
          orderBy: { id: 'asc' },
          take: MAX_TEAM_RESPONDERS,
        })
      : [];
  const ids = new Set([...named, ...members.map(member => member.userId)]);
  if (ids.size === 0) return [];
  const active = await prisma.user.findMany({
    where: { id: { in: [...ids] }, status: 'ACTIVE' },
    select: { id: true },
  });
  return active.map(user => user.id);
}
