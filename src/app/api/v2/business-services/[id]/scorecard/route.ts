import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { getBusinessServiceScorecard } from '@/lib/business-services/scorecard-service';

/** The business service scored against the configured rubric: checks, score and level. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => ({
    data: await getBusinessServiceScorecard(params.id, actor),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
