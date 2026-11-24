import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  BusinessServiceTemplateInputSchema,
  createBusinessServiceTemplate,
  listBusinessServiceTemplates,
} from '@/lib/business-services/templates';

/** Templates are configuration for people who create business services, so reading needs the same access as creating. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({}).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ actor }) => ({
    data: await listBusinessServiceTemplates(actor),
    headers: { 'Cache-Control': 'no-store' },
  }),
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({}).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: BusinessServiceTemplateInputSchema,
  idempotent: true,
  handler: async ({ body, actor, tx }) => ({
    status: 201,
    data: await createBusinessServiceTemplate(body, { actor, source: 'API' }, tx),
  }),
});
