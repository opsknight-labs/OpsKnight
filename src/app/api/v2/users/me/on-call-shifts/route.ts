import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import {
  MY_SHIFTS_DEFAULT_DAYS,
  MY_SHIFTS_DEFAULT_LIMIT,
  MY_SHIFTS_MAX_DAYS,
  MY_SHIFTS_MAX_LIMIT,
  getMyOnCallShifts,
} from '@/lib/oncall-my-shifts';

const querySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(MY_SHIFTS_MAX_DAYS).default(MY_SHIFTS_DEFAULT_DAYS),
    limit: z.coerce.number().int().min(1).max(MY_SHIFTS_MAX_LIMIT).default(MY_SHIFTS_DEFAULT_LIMIT),
  })
  .strict();

/** The credential owner's current and upcoming on-call shifts across every readable schedule. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  scopedFilter: true,
  querySchema,
  handler: async ({ actor, query }) => {
    if (!actor.id)
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Active user access is required.',
      });
    const data = await getMyOnCallShifts({
      userId: actor.id,
      readWhere: scheduleReadWhere(actor),
      days: query.days,
      limit: query.limit,
    });
    return { data, headers: { 'Cache-Control': 'private, no-store' } };
  },
});
