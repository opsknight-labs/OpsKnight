import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import {
  BUSINESS_SERVICE_SELECT,
  BusinessServiceInputSchema,
  businessServiceDto,
  businessServiceReadWhere,
  createBusinessService,
} from '@/lib/business-services/commands';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  paramsSchema: z.object({}).strict(),
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ actor, pagination }) => {
    const rows = await prisma.businessService.findMany({
      where: { AND: [businessServiceReadWhere(actor), buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: BUSINESS_SERVICE_SELECT,
    });
    const result = formatCursorPagination(rows, pagination.limit);
    return {
      data: result.data.map(businessServiceDto),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({}).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: BusinessServiceInputSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) => {
    const created = await createBusinessService(body, { actor, source: 'API' }, tx);
    await logV2Audit({
      action: 'business_service.created',
      entityType: 'SERVICE',
      entityId: created.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: created.name },
      tx,
    });
    return { status: 201, data: businessServiceDto(created) };
  },
});
