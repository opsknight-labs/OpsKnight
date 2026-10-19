import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { projectRunbookPool, fleetCommandOptions } from '@/lib/api-v2/runbook-pools';
import { createRunbookAgentPool } from '@/lib/runbooks/pool-commands';
import { createRunbookAgentPoolSchema } from '@/lib/runbooks/schemas';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ pagination }) => {
    const rows = await prisma.runbookAgentPool.findMany({
      where: buildCursorWhere(pagination.cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const page = formatCursorPagination(rows, pagination.limit);
    return {
      data: page.data.map(projectRunbookPool),
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: createRunbookAgentPoolSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => {
    const pool = await createRunbookAgentPool(
      context.body,
      { id: context.actor.id, apiKeyId: context.apiKey.id },
      fleetCommandOptions(context)
    );
    return {
      status: 201,
      data: projectRunbookPool(pool),
      headers: {
        ...etagHeaders(pool.revision),
        'Cache-Control': 'no-store',
        Location: `/api/v2/runbooks/agent-pools/${pool.id}`,
      },
    };
  },
});
