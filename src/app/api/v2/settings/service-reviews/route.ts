import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  getReviewConfig,
  reviewConfigSchema,
  saveReviewConfig,
} from '@/lib/business-services/reviews/config';

/** Org switch and schedule for monthly business service reviews. Off by default; admin only. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE,
  querySchema: z.object({}).strict(),
  handler: async () => ({
    data: await getReviewConfig(),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: reviewConfigSchema,
  idempotent: true,
  handler: async ({ body, actor, tx }) => ({
    data: await saveReviewConfig(body, { id: actor.id, source: 'API' }, tx),
    headers: { 'Cache-Control': 'private, no-store' },
  }),
});
