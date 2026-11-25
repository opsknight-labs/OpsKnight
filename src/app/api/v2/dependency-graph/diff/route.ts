import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { diffGraph } from '@/lib/intelligence/dependencies/insights/service';

/** What changed in the dependency graph since a past time (at most 400 days back). */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  querySchema: z
    .object({
      since: z.string().datetime({ offset: true }),
      focus: z.string().trim().max(110).optional(),
      hops: z.coerce.number().int().min(1).max(3).default(2),
    })
    .strict(),
  handler: async ({ actor, query }) => ({
    data: await diffGraph(actor, new Date(query.since), { focus: query.focus, hops: query.hops }),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
