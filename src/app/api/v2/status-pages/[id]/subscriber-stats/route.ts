import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  StatusSubscriberPageParams,
  requireStatusSubscriberPage,
} from '@/lib/api-v2/status-page-subscribers';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_READ,
  paramsSchema: StatusSubscriberPageParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const data = await prisma.$transaction(
      async tx => {
        await requireStatusSubscriberPage(tx, params.id);
        const groups = await tx.statusPageSubscription.groupBy({
          by: ['state'],
          where: { statusPageId: params.id },
          _count: { _all: true },
        });
        return {
          statusPageId: params.id,
          total: groups.reduce((n, row) => n + row._count._all, 0),
          states: groups.map(row => ({ state: row.state, count: row._count._all })),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
    return { data, headers: { 'Cache-Control': 'no-store' } };
  },
});
