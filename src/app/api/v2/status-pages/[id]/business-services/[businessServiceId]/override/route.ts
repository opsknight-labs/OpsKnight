import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  setStatusPageBusinessServiceOverride,
  StatusOverrideInputSchema,
} from '@/lib/status-pages/business-service-overrides';

const Params = z
  .object({ id: z.string().cuid(), businessServiceId: z.string().trim().min(1).max(100) })
  .strict();

/**
 * Pins a business service's public status on this page (a component-group override) until
 * `until` (default and maximum 30 days), or clears it with `status: null`. Applies immediately.
 */
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: Params,
  querySchema: z.object({}).strict(),
  bodySchema: StatusOverrideInputSchema,
  idempotent: true,
  handler: async ({ params, body, actor, tx }) => ({
    data: await setStatusPageBusinessServiceOverride(
      params.id,
      params.businessServiceId,
      body,
      { actor, source: 'API' },
      new Date(),
      tx
    ),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
