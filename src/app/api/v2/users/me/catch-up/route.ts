import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import {
  CATCH_UP_DEFAULT_HOURS,
  CATCH_UP_DEFAULT_LIMIT,
  CATCH_UP_MAX_HOURS,
  CATCH_UP_MAX_LIMIT,
  getCatchUp,
} from '@/lib/oncall-catch-up';

const querySchema = z
  .object({
    hours: z.coerce.number().int().min(1).max(CATCH_UP_MAX_HOURS).default(CATCH_UP_DEFAULT_HOURS),
    limit: z.coerce.number().int().min(1).max(CATCH_UP_MAX_LIMIT).default(CATCH_UP_DEFAULT_LIMIT),
  })
  .strict();

/** What opened, resolved and is still active since a point in time, over incidents the caller can read. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  scopedFilter: true,
  querySchema,
  handler: async ({ actor, query }) => {
    if (!actor.id)
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Active user access is required.',
      });
    const data = await getCatchUp({
      userId: actor.id,
      readWhere: incidentReadWhere(actor),
      hours: query.hours,
      limit: query.limit,
    });
    return { data, headers: { 'Cache-Control': 'private, no-store' } };
  },
});
