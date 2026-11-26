import { scheduleReadWhere } from '@/lib/authorization-filters';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import type { getCurrentAuthorizationActor } from '@/lib/rbac';

/** Who the first escalation step reaches now; null when there is none or it cannot be read. */
export type OnCall = { label: string; names: string[] } | null;

/** The first escalation step, as the graph side panel and the business-service hero read it. */
export const FIRST_STEP_SELECT = {
  orderBy: { stepOrder: 'asc' },
  take: 1,
  select: {
    targetType: true,
    targetUser: { select: { name: true, email: true } },
    targetTeam: { select: { name: true } },
    targetScheduleId: true,
    targetSchedule: { select: { name: true } },
  },
} as const;

export async function onCallFor(
  step: {
    targetType: string;
    targetUser: { name: string | null; email: string } | null;
    targetTeam: { name: string } | null;
    targetScheduleId: string | null;
    targetSchedule: { name: string } | null;
  } | null,
  actor: Awaited<ReturnType<typeof getCurrentAuthorizationActor>>
): Promise<OnCall> {
  if (!step) return null;
  if (step.targetUser)
    return { label: 'Escalation target', names: [step.targetUser.name || 'Unnamed responder'] };
  if (step.targetTeam) return { label: 'Team', names: [step.targetTeam.name] };
  if (!step.targetScheduleId) return null;
  let where;
  try {
    where = scheduleReadWhere(actor);
  } catch {
    return null;
  }
  const shifts = await getActiveOnCallShifts(new Date(), {
    scheduleId: step.targetScheduleId,
    where,
  });
  return {
    label: step.targetSchedule?.name ?? 'Schedule',
    names: [...new Set(shifts.map(shift => shift.user.name || 'Unnamed responder'))],
  };
}
