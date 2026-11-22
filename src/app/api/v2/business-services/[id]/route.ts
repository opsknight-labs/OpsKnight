import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import {
  BUSINESS_SERVICE_SELECT,
  BusinessServiceInputSchema,
  businessServiceDto,
  businessServiceReadWhere,
  deleteBusinessService,
  updateBusinessService,
} from '@/lib/business-services/commands';
import { getBusinessServiceHealth } from '@/lib/business-services/contract';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => {
    const row = await prisma.businessService.findFirst({
      where: { AND: [{ id: params.id }, businessServiceReadWhere(actor)] },
      select: BUSINESS_SERVICE_SELECT,
    });
    if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const health = await getBusinessServiceHealth([row.id], actor);
    return {
      data: businessServiceDto(row, health.get(row.id)),
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

/** Members and followers are replaced as whole sets when present. */
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: BusinessServiceInputSchema.partial()
    .strict()
    .refine(value => Object.keys(value).length > 0, 'Provide at least one field to change.'),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const updated = await updateBusinessService(params.id, body, { actor, source: 'API' }, tx);
    await logV2Audit({
      action: 'business_service.updated',
      entityType: 'BUSINESS_SERVICE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { fields: Object.keys(body) },
      tx,
    });
    return { data: businessServiceDto(updated) };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_DELETE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) => {
    const result = await deleteBusinessService(params.id, { actor, source: 'API' }, tx);
    await logV2Audit({
      action: 'business_service.deleted',
      entityType: 'BUSINESS_SERVICE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      tx,
    });
    return { data: result };
  },
});
