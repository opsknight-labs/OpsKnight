import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

/** Shared UI/REST command: removal revokes delivery, never erases consent/history. */
export async function removeStatusPageSubscribers(
  statusPageId: string,
  subscriptionIds: string[],
  actorId: string,
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const ids = [...new Set(subscriptionIds)];
  if (!ids.length || ids.length > 250) throw new AppError({ code: 'VALIDATION_FAILED' });
  const command = async (tx: Prisma.TransactionClient) => {
    if (!(await tx.statusPage.findUnique({ where: { id: statusPageId }, select: { id: true } })))
      throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
    const existing = await tx.statusPageSubscription.findMany({
      where: { id: { in: ids }, statusPageId },
      select: { id: true },
    });
    if (!existing.length)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Subscription not found.' });
    const validIds = existing.map(row => row.id);
    const changed = await tx.statusPageSubscription.updateMany({
      where: {
        id: { in: validIds },
        statusPageId,
        OR: [{ unsubscribedAt: null }, { state: { not: 'UNSUBSCRIBED' } }],
      },
      data: { unsubscribedAt: new Date(), state: 'UNSUBSCRIBED' },
    });
    await tx.notification.updateMany({
      where: {
        recipientType: 'SUBSCRIBER',
        recipientId: { in: validIds },
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: {
        status: 'SKIPPED',
        payloadEncrypted: null,
        errorMsg: 'Subscription was revoked before delivery.',
      },
    });
    if (changed.count)
      await logAudit(
        {
          action: 'status_page.subscribers.removed',
          entityType: 'STATUS_PAGE',
          entityId: statusPageId,
          actorId,
          source: apiClientId ? 'API' : 'UI',
          details: {
            subscriptionIds: validIds,
            changed: changed.count,
            ...(apiClientId ? { apiClientId } : {}),
          },
        },
        tx
      );
    return { count: validIds.length, changed: changed.count };
  };
  return externalTx ? command(externalTx) : prisma.$transaction(command);
}
