import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  deleteView,
  getView,
  updateView,
  viewInputSchema,
} from '@/lib/intelligence/dependencies/insights/views';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => ({
    data: await getView(actor, params.id),
    headers: { 'Cache-Control': 'no-store' },
  }),
});

/** Owner or Admin only. */
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: viewInputSchema
    .partial()
    .strict()
    .refine(value => Object.keys(value).length > 0, 'Provide at least one field to change.'),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ actor, params, body }) => ({ data: await updateView(actor, params.id, body) }),
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ actor, params }) => {
    await deleteView(actor, params.id);
    return { status: 204 };
  },
});
