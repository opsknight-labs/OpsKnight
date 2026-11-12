import prisma from '@/lib/prisma';
import {
  ActionItemListQuerySchema,
  buildCursorWhere,
  defineV2Route,
  formatCursorPagination,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import type { Prisma } from '@prisma/client';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
  scopedFilter: true,
  querySchema: ActionItemListQuerySchema,
  handler: async ({ actor, query, pagination }) => {
    // An item is exactly as visible as its parent postmortem; filters only ever narrow this.
    const filters: Prisma.ActionItemWhereInput[] = [{ postmortem: postmortemReadWhere(actor) }];

    if (query.status) filters.push({ status: query.status });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.ownerId) filters.push({ ownerId: query.ownerId === 'me' ? actor.id : query.ownerId });
    if (query.incidentId) filters.push({ incidentId: query.incidentId });
    if (query.postmortemId) filters.push({ postmortemId: query.postmortemId });
    if (query.overdue !== undefined) {
      const now = new Date();
      // Spelled out rather than NOT(...): SQL's NOT would drop items without a due date.
      filters.push(
        query.overdue
          ? { dueDate: { lt: now }, status: { not: 'COMPLETED' } }
          : { OR: [{ dueDate: null }, { dueDate: { gte: now } }, { status: 'COMPLETED' }] }
      );
    }

    const cursorWhere = buildCursorWhere(pagination.cursor);
    if (cursorWhere.OR) filters.push(cursorWhere as Prisma.ActionItemWhereInput);

    const items = await prisma.actionItem.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: {
        id: true,
        postmortemId: true,
        incidentId: true,
        title: true,
        description: true,
        ownerId: true,
        owner: { select: { id: true, name: true } },
        dueDate: true,
        status: true,
        priority: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        incident: { select: { id: true, title: true } },
      },
    });

    const result = formatCursorPagination(items, pagination.limit);
    return {
      data: result.data,
      pagination: result.pagination,
      headers: { 'Cache-Control': 'private, no-store' },
    };
  },
});
