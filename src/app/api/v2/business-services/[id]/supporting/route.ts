import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  setSupportingBusinessServices,
  SupportingInputSchema,
} from '@/lib/business-services/supporting';

/** Replaces the business services this one depends on (nested business services). Acyclic. */
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: SupportingInputSchema,
  idempotent: true,
  handler: async ({ params, body, actor, tx }) => ({
    data: await setSupportingBusinessServices(
      params.id,
      body,
      { actor, source: 'API' },
      { client: tx }
    ),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
