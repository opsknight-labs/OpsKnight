import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import { AppError } from '@/lib/errors';

const DAY_MS = 24 * 60 * 60 * 1000;
const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const querySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
}).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  scopedFilter: true,
  paramsSchema,
  querySchema,
  handler: async ({ params, query, actor }) => {
    const start = new Date(query.start);
    const end = new Date(query.end);
    if (end.getTime() <= start.getTime() || end.getTime() - start.getTime() > 7 * DAY_MS) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Coverage range must be greater than zero and no longer than seven days.',
      });
    }

    const schedule = await prisma.onCallSchedule.findFirst({
      where: { AND: [{ id: params.id }, scheduleReadWhere(actor)] },
      select: { id: true, name: true, timeZone: true, revision: true },
    });
    if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });

    const shifts = await getWindowOnCallShifts(start, end, schedule.id);
    const intervals = shifts
      .map(shift => ({
        start: Math.max(start.getTime(), shift.start.getTime()),
        end: Math.min(end.getTime(), shift.end.getTime()),
      }))
      .filter(interval => interval.end > interval.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const gaps: Array<{ start: string; end: string }> = [];
    let coveredUntil = start.getTime();
    for (const interval of intervals) {
      if (interval.start > coveredUntil) {
        gaps.push({ start: new Date(coveredUntil).toISOString(), end: new Date(interval.start).toISOString() });
      }
      coveredUntil = Math.max(coveredUntil, interval.end);
    }
    if (coveredUntil < end.getTime()) {
      gaps.push({ start: new Date(coveredUntil).toISOString(), end: end.toISOString() });
    }

    return {
      data: {
        schedule,
        start: start.toISOString(),
        end: end.toISOString(),
        shifts: shifts.map(shift => ({
          userId: shift.userId,
          start: new Date(Math.max(start.getTime(), shift.start.getTime())).toISOString(),
          end: new Date(Math.min(end.getTime(), shift.end.getTime())).toISOString(),
        })),
        gaps,
      },
    };
  },
});
