import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { getImpactTimeline } from '@/lib/business-services/contract';
import { ImpactWindowQuerySchema } from '@/lib/business-services/api';

/** Incidents that impacted the business service in the window (unmarked ones left out), newest first. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: ImpactWindowQuerySchema,
  handler: async ({ actor, params, query }) => {
    const entries = await getImpactTimeline(params.id, query, actor);
    return {
      data: entries
        .filter(entry => !entry.excluded)
        .map(entry => ({
          id: entry.incidentId,
          title: entry.incidentTitle,
          urgency: entry.urgency,
          source: entry.source,
          impactStartedAt: entry.startedAt,
          impactEndedAt: entry.endedAt,
        })),
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
