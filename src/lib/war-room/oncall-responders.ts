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
