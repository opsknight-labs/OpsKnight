import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS, actorHasCapability } from '@/lib/authorization-policy';
import { CAPABILITIES } from '@/lib/authorization';
import { listReviewRuns } from '@/lib/business-services/reviews/run';

/** Recent review runs: admins see every recipient, responders only their own rows. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ,
  scopedFilter: true,
  querySchema: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict(),
  handler: async ({ actor, query }) => ({
    data: await listReviewRuns(
      { id: actor.id, global: actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE) },
      query.limit
    ),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});
