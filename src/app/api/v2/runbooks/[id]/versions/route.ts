import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RunbookParams, projectAuthoringVersion } from '@/lib/api-v2/runbook-authoring';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { formatCursorPagination, buildCursorWhere } from '@/lib/api-v2/pagination';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: RunbookParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    const runbook = await prisma.runbook.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!runbook) throw new AppError({ code: 'RUNBOOK_NOT_FOUND' });
    const versions = await prisma.runbookVersion.findMany({
      where: { AND: [{ runbookId: params.id }, buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(versions, pagination.limit);
    return { data: result.data.map(projectAuthoringVersion), pagination: result.pagination };
  },
});
