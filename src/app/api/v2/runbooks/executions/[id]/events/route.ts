import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ExecutionParams, requireReadableExecution } from '@/lib/api-v2/runbook-intervention';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_READ,
  scopedFilter: true,
  paramsSchema: ExecutionParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ actor, params, pagination }) => {
    await requireReadableExecution(prisma, actor, params.id);
    const rows = await prisma.auditLog.findMany({
      where: {
        AND: [
          { entityType: 'RUNBOOK_EXECUTION', entityId: params.id },
          buildCursorWhere(pagination.cursor),
        ],
      },
      select: { id: true, action: true, actorId: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(rows, pagination.limit);
    return {
      data: result.data,
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
