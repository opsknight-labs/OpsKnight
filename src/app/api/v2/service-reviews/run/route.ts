import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { runServiceReviews } from '@/lib/business-services/reviews/run';

/**
 * Runs last month's review now. Each (period, recipient) is claimed once, so repeating the call
 * returns `alreadySent` instead of sending again.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  idempotent: true,
  handler: async ({ actor }) => ({
    data: await runServiceReviews({ manual: true, actorId: actor.id }),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});
