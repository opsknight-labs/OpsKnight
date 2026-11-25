import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { BulkEditInputSchema, bulkEditBusinessServices } from '@/lib/business-services/bulk';

/**
 * Applies one change set to up to 100 business services. Each service succeeds or fails on its
 * own (per-item results); `dryRun: true` reports what would happen and writes nothing.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({}).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: BulkEditInputSchema,
  idempotent: true,
  handler: async ({ body, actor, tx }) => ({
    data: await bulkEditBusinessServices(body, { actor, source: 'API' }, tx),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
