import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  StatusSubscriberParams,
  statusSubscriberSelect,
  requireStatusSubscriberPage,
} from '@/lib/api-v2/status-page-subscribers';
import { removeStatusPageSubscribers } from '@/lib/status-pages/subscriber-administration';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_READ,
  paramsSchema: StatusSubscriberParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    await requireStatusSubscriberPage(prisma, params.id);
    const row = await prisma.statusPageSubscription.findFirst({
      where: { id: params.subscriberId, statusPageId: params.id },
      select: statusSubscriberSelect,
    });
    if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: row, headers: { 'Cache-Control': 'no-store' } };
  },
});
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_MANAGE,
  paramsSchema: StatusSubscriberParams,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) => {
    await removeStatusPageSubscribers(params.id, [params.subscriberId], actor.id, tx, apiKey.id);
    return { status: 204 };
  },
});
