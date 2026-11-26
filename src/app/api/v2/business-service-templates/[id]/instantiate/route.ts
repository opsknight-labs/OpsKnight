import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { businessServiceDto, BusinessServiceInputSchema } from '@/lib/business-services/commands';
import { createBusinessServiceFromTemplate } from '@/lib/business-services/templates';

/** Creates a business service from the template's defaults; the body can override any field. */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: BusinessServiceInputSchema.partial().required({ name: true }),
  idempotent: true,
  handler: async ({ params, body, actor, tx }) => {
    const created = await createBusinessServiceFromTemplate(
      params.id,
      body as Parameters<typeof createBusinessServiceFromTemplate>[1],
      { actor, source: 'API' },
      tx
    );
    return { status: 201, data: businessServiceDto(created, undefined, undefined, true) };
  },
});
