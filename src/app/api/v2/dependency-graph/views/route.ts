import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { createView, listViews, viewInputSchema } from '@/lib/intelligence/dependencies/insights/views';

/** Saved views the caller owns, shares through a team, or that are org-wide. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  querySchema: z.object({}).strict(),
  handler: async ({ actor }) => ({
    data: await listViews(actor),
    headers: { 'Cache-Control': 'no-store' },
  }),
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  querySchema: z.object({}).strict(),
  bodySchema: viewInputSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ actor, body }) => ({ status: 201, data: await createView(actor, body) }),
});
