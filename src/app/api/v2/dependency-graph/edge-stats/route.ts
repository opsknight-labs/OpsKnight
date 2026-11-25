import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { edgeStatsBatchSchema, ingestEdgeStats } from '@/lib/intelligence/dependencies/insights/edge-stats';

/** Integration ingestion of measured traffic per dependency edge; needs services:write. */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_UPDATE,
  scopedFilter: true,
  querySchema: z.object({}).strict(),
  bodySchema: edgeStatsBatchSchema,
  handler: async ({ actor, body }) => ({ data: await ingestEdgeStats(actor, body) }),
});
