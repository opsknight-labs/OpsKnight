import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { getBusinessServiceStats, getImpactTimeline } from '@/lib/business-services/contract';
import { ImpactWindowQuerySchema } from '@/lib/business-services/api';
import { withImpactCost } from '@/lib/business-services/impact-cost-read';

/** Impact intervals in the window (including unmarked ones, flagged) and the union-based stats. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: ImpactWindowQuerySchema,
  handler: async ({ actor, params, query }) => {
    const [entries, stats] = await Promise.all([
      getImpactTimeline(params.id, query, actor),
      getBusinessServiceStats(params.id, query, actor),
    ]);
    return {
      data: { businessServiceId: params.id, ...stats, ...(await withImpactCost(params.id, stats, entries)) },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
