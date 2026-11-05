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

const id = z.string().trim().min(1).max(100);
const querySchema = z
  .object({
    hours: z.coerce.number().int().min(1).max(CATCH_UP_MAX_HOURS).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    scope: z.enum(['mine', 'all']).default('mine'),
    serviceId: id.optional(),
    teamId: id.optional(),
    urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
    limit: z.coerce.number().int().min(1).max(CATCH_UP_MAX_LIMIT).default(CATCH_UP_DEFAULT_LIMIT),
  })
  .strict()
  .refine(query => !(query.hours !== undefined && query.since !== undefined), {
    message: 'Use either hours or since, not both.',
    path: ['since'],
  });

/**
 * What opened, resolved and is still active since a point in time, plus which incidents paged the
 * caller. `scope=mine` (default) narrows to incidents assigned to, watched by or owned by a team of
 * the caller; `scope=all` is everything they may read.
 */
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
    const now = new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(now.getTime() - (query.hours ?? CATCH_UP_DEFAULT_HOURS) * 60 * 60 * 1000);
    // A start in the future, or further back than the bound, is a mistake worth saying out loud.
    if (
      Number.isNaN(since.getTime()) ||
      since.getTime() > now.getTime() ||
      now.getTime() - since.getTime() > CATCH_UP_MAX_HOURS * 60 * 60 * 1000
    )
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: `since must be in the past and within the last ${CATCH_UP_MAX_HOURS} hours.`,
      });
    const data = await getCatchUp({
      userId: actor.id,
      readWhere: incidentReadWhere(actor),
      since,
      limit: query.limit,
      scope: query.scope,
      serviceId: query.serviceId,
      teamId: query.teamId,
      urgency: query.urgency,
      now,
    });
    return { data, headers: { 'Cache-Control': 'private, no-store' } };
  },
});
