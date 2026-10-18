import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import {
  executeIdempotentStatusPageSection,
  StatusPageParams,
  StatusPageServiceSet,
  requireStatusPageSettings,
} from '@/lib/api-v2/status-page-settings';
import { z } from 'zod';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  paramsSchema: StatusPageParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    const page = await requireStatusPageSettings(prisma, params.id);
    const rows = await prisma.statusPageService.findMany({
      where: { AND: [{ statusPageId: params.id }, buildCursorWhere(pagination.cursor)] },
      select: {
        id: true,
        statusPageId: true,
        serviceId: true,
        displayName: true,
        order: true,
        showOnPage: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(rows, pagination.limit);
    return {
      data: result.data,
      pagination: result.pagination,
      headers: { ...etagHeaders(page.revision), 'Cache-Control': 'no-store' },
    };
  },
});
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  bodySchema: StatusPageServiceSet,
  preconditionRequired: true,
  handler: async ({ params, body, actor, apiKey, req }) => {
    const result = await executeIdempotentStatusPageSection(
      req,
      apiKey.id,
      params.id,
      body,
      { id: actor.id, apiClientId: apiKey.id },
      requireRevisionIfMatch(req),
      'services'
    );
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'no-store', ...(result.replayed ? { 'Idempotency-Replayed': 'true' } : {}) },
    };
  },
});
