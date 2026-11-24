import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { sendReviewPreview } from '@/lib/business-services/reviews/run';

/** Emails the caller their own preview (only services they can read). 3 per hour. */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ,
  scopedFilter: true,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  idempotent: true,
  handler: async ({ actor }) => ({
    data: await sendReviewPreview(actor.id),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});
