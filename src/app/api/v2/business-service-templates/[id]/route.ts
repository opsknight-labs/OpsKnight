import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  BusinessServiceTemplatePatchSchema,
  deleteBusinessServiceTemplate,
  updateBusinessServiceTemplate,
} from '@/lib/business-services/templates';

const params = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: params,
  querySchema: z.object({}).strict(),
  bodySchema: BusinessServiceTemplatePatchSchema,
  idempotent: true,
  handler: async ({ params, body, actor, tx }) => ({
    data: await updateBusinessServiceTemplate(params.id, body, { actor, source: 'API' }, tx),
  }),
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: params,
  querySchema: z.object({}).strict(),
  idempotent: true,
  handler: async ({ params, actor, tx }) => ({
    data: await deleteBusinessServiceTemplate(params.id, { actor, source: 'API' }, tx),
  }),
});
