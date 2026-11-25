import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { findSinglePointsOfFailure } from '@/lib/intelligence/dependencies/insights/service';

/** High fan-out services with no owner team or no on-call, ranked, plus articulation points. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  querySchema: z
    .object({
      threshold: z.coerce.number().int().min(1).max(200).default(5),
      focus: z.string().trim().max(110).optional(),
      hops: z.coerce.number().int().min(1).max(3).default(2),
    })
    .strict(),
  handler: async ({ actor, query }) => ({
    data: await findSinglePointsOfFailure(actor, query),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
