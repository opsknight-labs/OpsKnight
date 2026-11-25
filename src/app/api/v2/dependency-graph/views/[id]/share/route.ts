import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { revokeShare, shareView } from '@/lib/intelligence/dependencies/insights/views';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

/** Admin only, and only while graphEmbed.enabled is on. The token is returned once. */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_UPDATE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({ expiresInDays: z.number().int().min(1).max(90).default(30) })
    .strict(),
  // A replay would hand out a second token, so a retry must be a new request.
  handler: async ({ actor, params, body }) => ({
    status: 201,
    data: await shareView(actor, params.id, body.expiresInDays),
    headers: { 'Cache-Control': 'no-store' },
  }),
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ actor, params }) => {
    await revokeShare(actor, params.id);
    return { status: 204 };
  },
});
