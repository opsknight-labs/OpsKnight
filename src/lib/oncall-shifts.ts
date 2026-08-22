import prisma from '@/lib/prisma';
import { buildScheduleBlocks, getFinalScheduleBlocks } from './oncall';

export interface DynamicOnCallShift {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string | null;
    avatarUrl?: string | null;
    gender?: string | null;
  };
  scheduleId: string;
  schedule: {
    id: string;
    name: string;
  };
  start: Date;
  end: Date;
}

/**
 * Resolves all active on-call shifts across all schedules for a given point in time.
 * Replaces legacy queries to the empty `OnCallShift` table with dynamic schedule rotation math.
 */
export async function getActiveOnCallShifts(
  atTime: Date = new Date()
): Promise<DynamicOnCallShift[]> {
  if (!prisma?.onCallSchedule?.findMany) {
    return [];
  }
  const schedules = await prisma.onCallSchedule.findMany({
    include: {
      layers: {
        include: {
          users: {
            include: {
              user: {
                select: { id: true, name: true, avatarUrl: true, gender: true },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { priority: 'desc' },
      },
      overrides: {
        where: {
          start: { lte: atTime },
          end: { gte: atTime },
        },
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true, gender: true },
          },
        },
      },
    },
  });

  const activeShifts: DynamicOnCallShift[] = [];

  for (const schedule of schedules) {
    if (!schedule.layers.length && !schedule.overrides.length) continue;

    // Buffer window around atTime (-1 day to +2 days in schedule's timezone)
    const windowStart = new Date(atTime.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(atTime.getTime() + 48 * 60 * 60 * 1000);

    const blocks = buildScheduleBlocks(
      schedule.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        start: layer.start,
        end: layer.end,
        rotationLengthHours: layer.rotationLengthHours,
        shiftLengthHours: (layer as { shiftLengthHours?: number | null }).shiftLengthHours,
        restrictions: layer.restrictions as any,
        priority: (layer as { priority?: number }).priority,
        users: layer.users.map(lu => ({
          userId: lu.userId,
          user: { name: lu.user.name, avatarUrl: lu.user.avatarUrl, gender: lu.user.gender },
          position: lu.position,
        })),
      })),
      schedule.overrides.map(override => ({
        id: override.id,
        userId: override.userId,
        user: {
          name: override.user.name,
          avatarUrl: override.user.avatarUrl,
          gender: override.user.gender,
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
          avatarUrl: block.userAvatar,
          gender: block.userGender,
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
 * Resolves all shifts across all schedules within a time window for coverage & on-call hours calculations.
 */
export async function getWindowOnCallShifts(
  windowStart: Date,
  windowEnd: Date
): Promise<DynamicOnCallShift[]> {
  if (!prisma?.onCallSchedule?.findMany) {
    return [];
  }
  const schedules = await prisma.onCallSchedule.findMany({
    include: {
      layers: {
        include: {
          users: {
            include: {
              user: {
                select: { id: true, name: true, avatarUrl: true, gender: true },
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
        },
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true, gender: true },
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
        restrictions: layer.restrictions as any,
        priority: (layer as { priority?: number }).priority,
        users: layer.users.map(lu => ({
          userId: lu.userId,
          user: { name: lu.user.name, avatarUrl: lu.user.avatarUrl, gender: lu.user.gender },
          position: lu.position,
        })),
      })),
      schedule.overrides.map(override => ({
        id: override.id,
        userId: override.userId,
        user: {
          name: override.user.name,
          avatarUrl: override.user.avatarUrl,
          gender: override.user.gender,
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
          avatarUrl: block.userAvatar,
          gender: block.userGender,
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
