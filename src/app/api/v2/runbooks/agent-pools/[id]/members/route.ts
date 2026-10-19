import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PoolParams, requireRunbookPool } from '@/lib/api-v2/runbook-pools';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { redactRunbookDisplayName } from '@/lib/runbooks/display-name';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  paramsSchema: PoolParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    await requireRunbookPool(prisma, params.id);
    const rows = await prisma.runbookAgentPoolMember.findMany({
      where: { AND: [{ poolId: params.id }, buildCursorWhere(pagination.cursor)] },
      select: {
        id: true,
        poolId: true,
        agentId: true,
        source: true,
        createdAt: true,
        agent: { select: { id: true, name: true, status: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const page = formatCursorPagination(rows, pagination.limit);
    return {
      data: page.data.map(row => ({
        ...row,
        agent: { ...row.agent, name: redactRunbookDisplayName(row.agent.name) },
      })),
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
