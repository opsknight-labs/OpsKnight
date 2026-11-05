import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { ON_CALL_NOW_DEFAULT_LIMIT, ON_CALL_NOW_MAX_LIMIT, getOnCallNow } from '@/lib/oncall-now';

const querySchema = z
  .object({
    scope: z.enum(['mine', 'all']).default('mine'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ON_CALL_NOW_MAX_LIMIT)
      .default(ON_CALL_NOW_DEFAULT_LIMIT),
  })
  .strict();

/** Who is on call now, and who is next, across the schedules the caller (or their teams) takes part in. */
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
    const data = await getOnCallNow({
      userId: actor.id,
      readWhere: scheduleReadWhere(actor),
      scope: query.scope,
      limit: query.limit,
    });
    return { data, headers: { 'Cache-Control': 'private, no-store' } };
  },
});
