import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getWindowOnCallShifts, type DynamicOnCallShift } from '@/lib/oncall-shifts';
import { rotationMargin } from '@/lib/oncall-my-shifts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ON_CALL_NOW_DEFAULT_LIMIT = 25;
export const ON_CALL_NOW_MAX_LIMIT = 50;
/** How far ahead the next handover is looked for. */
const NEXT_LOOKAHEAD_MS = 7 * DAY_MS;
const MY_TEAM_LIMIT = 200;

export type OnCallNowScope = 'mine' | 'all';

type Block = Pick<DynamicOnCallShift, 'userId' | 'scheduleId' | 'start' | 'end' | 'user'>;

const person = (block: Block) => ({ userId: block.userId, name: block.user.name ?? null });

/** Back-to-back blocks of one person are one shift: the start and end it reaches through any that touch it. */
function shiftEdges(block: Block, blocks: readonly Block[]) {
  const mine = blocks
    .filter(other => other.userId === block.userId)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  let start = block.start.getTime();
  let end = block.end.getTime();
  for (const other of [...mine].reverse())
    if (other.end.getTime() >= start && other.start.getTime() < start)
      start = other.start.getTime();
  for (const other of mine)
    if (other.start.getTime() <= end && other.end.getTime() > end) end = other.end.getTime();
  return { start, end };
}

/**
 * Who is on call right now, and who is next, for each schedule the caller can read. `scope=mine`
 * (default) keeps the schedules the caller, or someone on one of their teams, takes part in; `all`
 * is every schedule they may read. Names only (never contact details), from the same rotation math
 * as the schedule page. Bounded to `limit` schedules and a 7-day look-ahead for the next handover.
 */
export async function getOnCallNow(input: {
  userId: string;
  readWhere: Prisma.OnCallScheduleWhereInput;
  scope?: OnCallNowScope;
  limit: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const scope = input.scope ?? 'mine';
  const teamIds =
    scope === 'mine'
      ? (
          await prisma.teamMember.findMany({
            where: { userId: input.userId },
            select: { teamId: true },
            take: MY_TEAM_LIMIT,
          })
        ).map(member => member.teamId)
      : [];
  const mine: Prisma.OnCallScheduleWhereInput = {
    OR: [
      { layers: { some: { users: { some: { userId: input.userId } } } } },
      { overrides: { some: { userId: input.userId, end: { gt: now } } } },
      ...(teamIds.length
        ? [
            {
              layers: {
                some: {
                  users: {
                    some: { user: { teamMemberships: { some: { teamId: { in: teamIds } } } } },
                  },
                },
              },
            },
            // A teammate who is on a schedule only through a current or future override counts too.
            {
              overrides: {
                some: {
                  end: { gt: now },
                  user: { teamMemberships: { some: { teamId: { in: teamIds } } } },
                },
              },
            },
          ]
        : []),
    ],
  };
  const candidates = await prisma.onCallSchedule.findMany({
    where: { AND: [input.readWhere, ...(scope === 'mine' ? [mine] : [])] },
    select: { id: true, name: true, timeZone: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
  });
  const schedules = candidates.slice(0, input.limit);
  const ids = schedules.map(schedule => schedule.id);
  const windowEnd = new Date(now.getTime() + NEXT_LOOKAHEAD_MS);
  const margin = ids.length ? await rotationMargin(ids, now, windowEnd) : 0;
  const calcStart = now.getTime() - margin;
  const calcEnd = windowEnd.getTime() + margin;
  const blocks: Block[] = ids.length
    ? await getWindowOnCallShifts(new Date(calcStart), new Date(calcEnd), { id: { in: ids } })
    : [];
  const byIdBlocks = new Map<string, Block[]>();
  for (const block of blocks) {
    const list = byIdBlocks.get(block.scheduleId) ?? [];
    list.push(block);
    byIdBlocks.set(block.scheduleId, list);
  }

  const rows = schedules.map(schedule => {
    const list = byIdBlocks.get(schedule.id) ?? [];
    const current = list.filter(
      block => block.start.getTime() <= now.getTime() && block.end.getTime() > now.getTime()
    );
    const onCall = current.map(block => {
      const { start, end } = shiftEdges(block, list);
      return {
        ...person(block),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        startClamped: start <= calcStart,
        endClamped: end >= calcEnd,
      };
    });
    const currentIds = new Set(current.map(block => block.userId));
    const nextBlock = list
      .filter(block => block.start.getTime() > now.getTime() && !currentIds.has(block.userId))
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.userId.localeCompare(b.userId))
      .at(0);
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      scheduleTimeZone: schedule.timeZone || 'UTC',
      onCall,
      next: nextBlock
        ? {
            ...person(nextBlock),
            start: nextBlock.start.toISOString(),
            end: nextBlock.end.toISOString(),
          }
        : null,
      // A gap: nobody is on call. Worth surfacing, since it means a page would not reach a person.
      gap: onCall.length === 0,
    };
  });

  return {
    userId: input.userId,
    now: now.toISOString(),
    scope,
    iAmOnCall: rows.some(row => row.onCall.some(entry => entry.userId === input.userId)),
    schedules: rows,
    gaps: rows.filter(row => row.gap).length,
    truncated: candidates.length > input.limit,
    schedulesEvaluated: schedules.length,
  };
}
