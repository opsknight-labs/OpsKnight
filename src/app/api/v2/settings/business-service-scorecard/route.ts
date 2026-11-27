import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scorecardRubricSchema } from '@/lib/business-services/scorecard';
import { getScorecardRubric, saveScorecardRubric } from '@/lib/business-services/scorecard-config';

/** The business-service scorecard rubric: readable by every service reader. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // Organization-wide rules hold no team data, so team-scoped readers see them too.
  scopedFilter: true,
  querySchema: z.object({}).strict(),
  handler: async () => ({
    data: await getScorecardRubric(),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});

/** Replaces the rubric. Admin only; audited. */
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: scorecardRubricSchema,
  idempotent: true,
  handler: async ({ body, actor, tx }) => ({
    data: await saveScorecardRubric(body, { id: actor.id, source: 'API' }, tx),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});
