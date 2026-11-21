import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { ObjectiveParams, requireReadableObjective } from '@/lib/api-v2/service-objectives';
import { sloAlertPolicyInputSchema } from '@/lib/slo/burn-alerts/contract';
import { getSloAlertPolicy, saveSloAlertPolicy } from '@/lib/slo/burn-alerts/service';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => {
    await requireReadableObjective(prisma, actor, params.id);
    const policy = await getSloAlertPolicy(params.id);
    if (!policy) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: policy, headers: { 'Cache-Control': 'no-store' } };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_MANAGE,
  paramsSchema: ObjectiveParams,
  querySchema: z.object({}).strict(),
  bodySchema: sloAlertPolicyInputSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const policy = await saveSloAlertPolicy(tx!, params.id, body, {
      id: actor.id,
      source: 'API',
      apiClientId: apiKey.id,
    });
    return { data: policy, headers: { 'Cache-Control': 'no-store' } };
  },
});
