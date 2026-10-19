import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { FLEET_SELECT, projectFleetAgent } from '@/lib/api-v2/runbook-fleet';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ pagination }) => {
    const rows = await prisma.runbookAgent.findMany({
      where: buildCursorWhere(pagination.cursor),
      select: FLEET_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const page = formatCursorPagination(rows, pagination.limit);
    return {
      data: page.data.map(projectFleetAgent),
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
