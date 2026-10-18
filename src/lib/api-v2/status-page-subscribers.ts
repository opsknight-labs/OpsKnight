import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
export const StatusSubscriberPageParams = z.object({ id: z.string().cuid() }).strict();
export const StatusSubscriberParams = StatusSubscriberPageParams.extend({
  subscriberId: z.string().cuid(),
}).strict();
export const statusSubscriberSelect = {
  id: true,
  statusPageId: true,
  email: true,
  subscribedAt: true,
  unsubscribedAt: true,
  verified: true,
  state: true,
  timezone: true,
} satisfies Prisma.StatusPageSubscriptionSelect;
export async function requireStatusSubscriberPage(db: Prisma.TransactionClient, id: string) {
  if (!(await db.statusPage.findUnique({ where: { id }, select: { id: true } })))
    throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
}
