import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  ObjectiveParams,
  objectiveCursor,
  objectivePagination,
  projectObjective,
  requireReadableObjective,
} from '@/lib/api-v2/service-objectives';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ actor, params, pagination }) => {
    await requireReadableObjective(prisma, actor, params.id);
    const scope = `objective-versions:${params.id}`;
    const boundary = objectiveCursor(pagination.cursor, scope);
    const rows = await prisma.serviceObjective.findMany({
      where: {
        lineageId: params.id,
        ...(boundary
          ? {
              OR: [
                { activeFrom: { lt: boundary.at } },
                { activeFrom: boundary.at, id: { lt: boundary.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = objectivePagination(rows, pagination.limit, scope, row => row.activeFrom);
    return {
      data: result.data.map(projectObjective),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
