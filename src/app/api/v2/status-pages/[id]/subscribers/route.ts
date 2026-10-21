import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';
import {
  StatusSubscriberPageParams,
  statusSubscriberSelect,
  requireStatusSubscriberPage,
} from '@/lib/api-v2/status-page-subscribers';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_READ,
  paramsSchema: StatusSubscriberPageParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    await requireStatusSubscriberPage(prisma, params.id);
    // Use the signed createdAt cursor vocabulary with the canonical subscribedAt field.
    const cursor = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const rows = await prisma.statusPageSubscription.findMany({
      where: {
        AND: [
          { statusPageId: params.id },
          cursor
            ? {
                OR: [
                  { subscribedAt: { lt: new Date(cursor.createdAt) } },
                  { subscribedAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              }
            : {},
        ],
      },
      select: statusSubscriberSelect,
      orderBy: [{ subscribedAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(
      rows.map(row => ({ ...row, createdAt: row.subscribedAt })),
      pagination.limit
    );
    return {
      data: result.data.map(({ createdAt: _createdAt, ...row }) => row),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
