import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildScheduleBlocks, getFinalScheduleBlocks, type LayerRestrictions } from './oncall';

export interface DynamicOnCallShift {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    gender?: string | null;
    timeZone?: string | null;
    emailNotificationsEnabled?: boolean;
  };
  scheduleId: string;
  schedule: {
    id: string;
    name: string;
  };
  start: Date;
  end: Date;
}

export type ActiveOnCallShiftsOptions = {
  scheduleId?: string;
  where?: Prisma.OnCallScheduleWhereInput;
};

/**
 * Resolves all active on-call shifts across all schedules for a given point in time.
 * Replaces legacy queries to the empty `OnCallShift` table with dynamic schedule rotation math.
 */
export async function getActiveOnCallShifts(
  atTime: Date = new Date(),
  scheduleIdOrOptions?: string | ActiveOnCallShiftsOptions
): Promise<DynamicOnCallShift[]> {
  if (!prisma?.onCallSchedule?.findMany) {
    return [];
  }
  const windowStart = new Date(atTime.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(atTime.getTime() + 48 * 60 * 60 * 1000);

  const options: ActiveOnCallShiftsOptions | undefined =
    typeof scheduleIdOrOptions === 'string'
      ? { scheduleId: scheduleIdOrOptions }
      : scheduleIdOrOptions;

  const whereClause: Prisma.OnCallScheduleWhereInput | undefined = options?.where
    ? options.scheduleId
      ? { AND: [{ id: options.scheduleId }, options.where] }
      : options.where
    : options?.scheduleId
      ? { id: options.scheduleId }
      : undefined;

  const schedules = await prisma.onCallSchedule.findMany({
    where: whereClause,
    include: {
      layers: {
        include: {
          users: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                  gender: true,
                  status: true,
                  timeZone: true,
                  emailNotificationsEnabled: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { priority: 'desc' },
      },
      overrides: {
        where: {
          start: { lte: windowEnd },
          end: { gte: windowStart },
          user: { status: 'ACTIVE' },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              gender: true,
              timeZone: true,
              emailNotificationsEnabled: true,
            },
          },
        },
      },
    },
  });

  const activeShifts: DynamicOnCallShift[] = [];

  for (const schedule of schedules) {
    if (!schedule.layers.length && !schedule.overrides.length) continue;

    const blocks = buildScheduleBlocks(
      schedule.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        start: layer.start,
        end: layer.end,
        rotationLengthHours: layer.rotationLengthHours,
        shiftLengthHours: (layer as { shiftLengthHours?: number | null }).shiftLengthHours,
        restrictions: layer.restrictions as LayerRestrictions | null | undefined,
        priority: (layer as { priority?: number }).priority,
        users: layer.users
          .filter(lu => lu.user.status === 'ACTIVE')
          .map(lu => ({
            userId: lu.userId,
            user: {
              name: lu.user?.name ?? 'Unknown User',
              email: lu.user?.email ?? null,
              avatarUrl: lu.user?.avatarUrl ?? null,
              gender: lu.user?.gender ?? null,
              timeZone: lu.user?.timeZone ?? null,
              emailNotificationsEnabled: lu.user?.emailNotificationsEnabled ?? false,
            },
            position: lu.position,
          })),
      })),
      schedule.overrides.map(override => ({
        id: override.id,
        userId: override.userId,
        user: {
          name: override.user?.name ?? 'Unknown User',
          email: override.user?.email ?? null,
          avatarUrl: override.user?.avatarUrl ?? null,
          gender: override.user?.gender ?? null,
          timeZone: override.user?.timeZone ?? null,
          emailNotificationsEnabled: override.user?.emailNotificationsEnabled ?? false,
        },
        start: override.start,
        end: override.end,
        replacesUserId: override.replacesUserId,
      })),
      windowStart,
      windowEnd,
      schedule.timeZone || 'UTC'
    );

    const layerPriority = new Map<string, number>(
      schedule.layers.map(layer => [layer.id, (layer as { priority?: number }).priority ?? 0])
    );

    const finalBlocks = getFinalScheduleBlocks(blocks, layerPriority);

    const activeBlocks = finalBlocks.filter(
      b => b.start.getTime() <= atTime.getTime() && b.end.getTime() > atTime.getTime()
    );

    for (const block of activeBlocks) {
      activeShifts.push({
        id: `${schedule.id}-${block.userId}-${block.start.getTime()}`,
        userId: block.userId,
        user: {
          id: block.userId,
          name: block.userName,
          email: block.userEmail,
          avatarUrl: block.userAvatar,
          gender: block.userGender,
          timeZone: block.userTimeZone,
          emailNotificationsEnabled: block.userEmailNotificationsEnabled,
        },
        scheduleId: schedule.id,
        schedule: {
          id: schedule.id,
          name: schedule.name,
        },
        start: block.start,
        end: block.end,
      });
    }
  }

  return activeShifts;
}

/**
 * Resolves shifts in a time window for coverage and on-call hours calculations.
 * Pass a schedule id for bounded single-schedule API reads.
 */
export async function getWindowOnCallShifts(
  windowStart: Date,
  windowEnd: Date,
  scheduleId?: string
): Promise<DynamicOnCallShift[]> {
  if (!prisma?.onCallSchedule?.findMany) {
    return [];
  }
  const schedules = await prisma.onCallSchedule.findMany({
    where: scheduleId ? { id: scheduleId } : undefined,
    include: {
      layers: {
        include: {
          users: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                  gender: true,
                  status: true,
                  timeZone: true,
                  emailNotificationsEnabled: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { priority: 'desc' },
      },
      overrides: {
        where: {
          start: { lte: windowEnd },
          end: { gte: windowStart },
          user: { status: 'ACTIVE' },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              gender: true,
              timeZone: true,
              emailNotificationsEnabled: true,
            },
          },
        },
      },
    },
  });

  const shifts: DynamicOnCallShift[] = [];

  for (const schedule of schedules) {
    if (!schedule.layers.length && !schedule.overrides.length) continue;

    const blocks = buildScheduleBlocks(
      schedule.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        start: layer.start,
        end: layer.end,
        rotationLengthHours: layer.rotationLengthHours,
        shiftLengthHours: (layer as { shiftLengthHours?: number | null }).shiftLengthHours,
        restrictions: layer.restrictions as LayerRestrictions | null | undefined,
        priority: (layer as { priority?: number }).priority,
        users: layer.users
          .filter(lu => lu.user.status === 'ACTIVE')
          .map(lu => ({
            userId: lu.userId,
            user: {
              name: lu.user?.name ?? 'Unknown User',
              email: lu.user?.email ?? null,
              avatarUrl: lu.user?.avatarUrl ?? null,
              gender: lu.user?.gender ?? null,
              timeZone: lu.user?.timeZone ?? null,
              emailNotificationsEnabled: lu.user?.emailNotificationsEnabled ?? false,
            },
            position: lu.position,
          })),
      })),
      schedule.overrides.map(override => ({
        id: override.id,
        userId: override.userId,
        user: {
          name: override.user?.name ?? 'Unknown User',
          email: override.user?.email ?? null,
          avatarUrl: override.user?.avatarUrl ?? null,
          gender: override.user?.gender ?? null,
          timeZone: override.user?.timeZone ?? null,
          emailNotificationsEnabled: override.user?.emailNotificationsEnabled ?? false,
        },
        start: override.start,
        end: override.end,
        replacesUserId: override.replacesUserId,
      })),
      windowStart,
      windowEnd,
      schedule.timeZone || 'UTC'
    );

    const layerPriority = new Map<string, number>(
      schedule.layers.map(layer => [layer.id, (layer as { priority?: number }).priority ?? 0])
    );

    const finalBlocks = getFinalScheduleBlocks(blocks, layerPriority);

    // Filter to blocks overlapping the window
    const overlappingBlocks = finalBlocks.filter(
      b => b.start.getTime() < windowEnd.getTime() && b.end.getTime() > windowStart.getTime()
    );

    for (const block of overlappingBlocks) {
      shifts.push({
        id: `${schedule.id}-${block.userId}-${block.start.getTime()}`,
        userId: block.userId,
        user: {
          id: block.userId,
          name: block.userName,
          email: block.userEmail,
          avatarUrl: block.userAvatar,
          gender: block.userGender,
          timeZone: block.userTimeZone,
          emailNotificationsEnabled: block.userEmailNotificationsEnabled,
        },
        scheduleId: schedule.id,
        schedule: {
          id: schedule.id,
          name: schedule.name,
        },
        start: block.start,
        end: block.end,
      });
    }
  }

  return shifts;
}

/** How far ahead a shift end or the next handover is looked up. */
export const HANDOVER_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When each on-call user's current shift ends and who takes over next, from the same rotation
 * math the schedule page uses. Back-to-back blocks for one person are one shift. A shift that
 * runs past the lookahead window has no known end (null).
 */
export function handoverFromShifts(
  shifts: readonly Pick<DynamicOnCallShift, 'userId' | 'start' | 'end' | 'user'>[],
  onCallUserIds: readonly string[],
  at: Date,
  windowEnd: Date
) {
  const ordered = [...shifts].sort((a, b) => a.start.getTime() - b.start.getTime());
  const shiftEnds = new Map<string, string | null>();
  for (const userId of onCallUserIds) {
    let end: number | null = null;
    for (const shift of ordered) {
      if (shift.userId !== userId) continue;
      const start = shift.start.getTime();
      if (end === null ? start <= at.getTime() && shift.end.getTime() > at.getTime() : start <= end)
        end = Math.max(end ?? 0, shift.end.getTime());
    }
    shiftEnds.set(
      userId,
      end === null || end >= windowEnd.getTime() ? null : new Date(end).toISOString()
    );
  }
  const current = new Set(onCallUserIds);
  const upcoming = ordered.find(
    shift => shift.start.getTime() > at.getTime() && !current.has(shift.userId)
  );
  return {
    shiftEnds,
    next: upcoming
      ? {
          userId: upcoming.userId,
          name: upcoming.user.name,
          start: upcoming.start.toISOString(),
        }
      : null,
  };
}
