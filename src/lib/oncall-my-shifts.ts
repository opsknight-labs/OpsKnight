import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getWindowOnCallShifts, type DynamicOnCallShift } from '@/lib/oncall-shifts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Default and maximum look-ahead, in days. */
export const MY_SHIFTS_DEFAULT_DAYS = 14;
export const MY_SHIFTS_MAX_DAYS = 30;
/** Default and maximum number of shifts returned. */
export const MY_SHIFTS_DEFAULT_LIMIT = 20;
export const MY_SHIFTS_MAX_LIMIT = 50;
/** At most this many schedules are evaluated for one person; the rest are reported as truncated. */
export const MY_SHIFTS_SCHEDULE_LIMIT = 25;
/** Rotation math runs a little past the window so a shift's handoff can still be found. */
const HANDOFF_MARGIN_MS = DAY_MS;

export interface MyShift {
  scheduleId: string;
  scheduleName: string;
  scheduleTimeZone: string;
  start: string;
  end: string;
  current: boolean;
  /** Who is on call in the same schedule the moment this shift ends; null for a coverage gap. */
  handoffTo: { userId: string; name: string | null } | null;
}

type Block = Pick<DynamicOnCallShift, 'userId' | 'scheduleId' | 'start' | 'end' | 'user'>;

/** One person's back-to-back blocks in one schedule are one shift. */
function mergeBlocks(blocks: readonly Block[]) {
  const merged: { scheduleId: string; start: number; end: number }[] = [];
  for (const block of [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const last = merged.at(-1);
    if (last && last.scheduleId === block.scheduleId && block.start.getTime() <= last.end)
      last.end = Math.max(last.end, block.end.getTime());
    else
      merged.push({
        scheduleId: block.scheduleId,
        start: block.start.getTime(),
        end: block.end.getTime(),
      });
  }
  return merged;
}

/**
 * The caller's current and upcoming on-call shifts across every schedule they can read and take
 * part in (a rotation layer or an override), from the same rotation math the schedule page uses.
 * Bounded: at most MY_SHIFTS_SCHEDULE_LIMIT schedules, `days` of look-ahead and `limit` shifts.
 */
export async function getMyOnCallShifts(input: {
  userId: string;
  readWhere: Prisma.OnCallScheduleWhereInput;
  now?: Date;
  days: number;
  limit: number;
}) {
  const now = input.now ?? new Date();
  const windowEnd = new Date(now.getTime() + input.days * DAY_MS);
  const participation: Prisma.OnCallScheduleWhereInput = {
    OR: [
      { layers: { some: { users: { some: { userId: input.userId } } } } },
      {
        overrides: {
          some: { userId: input.userId, end: { gt: now }, start: { lt: windowEnd } },
        },
      },
    ],
  };
  const candidates = await prisma.onCallSchedule.findMany({
    where: { AND: [input.readWhere, participation] },
    select: { id: true, name: true, timeZone: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MY_SHIFTS_SCHEDULE_LIMIT + 1,
  });
  const schedules = candidates.slice(0, MY_SHIFTS_SCHEDULE_LIMIT);
  const byId = new Map(schedules.map(schedule => [schedule.id, schedule]));
  const blocks: Block[] = schedules.length
    ? await getWindowOnCallShifts(
        new Date(now.getTime() - HANDOFF_MARGIN_MS),
        new Date(windowEnd.getTime() + HANDOFF_MARGIN_MS),
        { id: { in: schedules.map(schedule => schedule.id) } }
      )
    : [];
  const mine = mergeBlocks(blocks.filter(block => block.userId === input.userId)).filter(
    shift => shift.end > now.getTime() && shift.start < windowEnd.getTime()
  );
  const handoff = (scheduleId: string, at: number) => {
    const next = blocks
      .filter(
        block =>
          block.scheduleId === scheduleId &&
          block.userId !== input.userId &&
          block.start.getTime() <= at &&
          block.end.getTime() > at
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.userId.localeCompare(b.userId))
      .at(0);
    return next ? { userId: next.userId, name: next.user.name ?? null } : null;
  };
  const shifts: MyShift[] = mine.slice(0, input.limit).map(shift => {
    const schedule = byId.get(shift.scheduleId)!;
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      scheduleTimeZone: schedule.timeZone || 'UTC',
      start: new Date(shift.start).toISOString(),
      end: new Date(shift.end).toISOString(),
      current: shift.start <= now.getTime(),
      handoffTo: handoff(shift.scheduleId, shift.end),
    };
  });
  const current = shifts.filter(shift => shift.current);
  // The next moment the caller's on-call status changes: a current shift ending or a new one starting.
  const changes = [
    ...current.map(shift => ({ at: shift.end, change: 'SHIFT_ENDS' as const, shift })),
    ...shifts
      .filter(shift => !shift.current)
      .map(shift => ({ at: shift.start, change: 'SHIFT_STARTS' as const, shift })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const first = changes.at(0);
  return {
    userId: input.userId,
    now: now.toISOString(),
    windowEnd: windowEnd.toISOString(),
    onCallNow: current.length > 0,
    nextHandoff: first
      ? {
          at: first.at,
          change: first.change,
          scheduleId: first.shift.scheduleId,
          scheduleName: first.shift.scheduleName,
          ...(first.change === 'SHIFT_ENDS' ? { handoffTo: first.shift.handoffTo } : {}),
        }
      : null,
    shifts,
    truncated: mine.length > input.limit || candidates.length > MY_SHIFTS_SCHEDULE_LIMIT,
    schedulesEvaluated: schedules.length,
  };
}
