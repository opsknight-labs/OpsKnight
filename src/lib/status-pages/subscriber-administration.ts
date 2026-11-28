import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { REVOCABLE_SUBSCRIPTION_STATES } from '@/lib/status-pages/subscription-policy';

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
    const revoked = await tx.statusPageSubscription.updateMany({
      where: { id: { in: validIds }, statusPageId, state: { in: REVOCABLE_SUBSCRIPTION_STATES } },
      data: { unsubscribedAt: new Date(), state: 'UNSUBSCRIBED' },
    });
    // Complained/bounced/suppressed rows record the removal but keep their suppression state.
    const suppressed = await tx.statusPageSubscription.updateMany({
      where: {
        id: { in: validIds },
        statusPageId,
        unsubscribedAt: null,
        state: { notIn: REVOCABLE_SUBSCRIPTION_STATES },
      },
      data: { unsubscribedAt: new Date() },
    });
    const changed = { count: revoked.count + suppressed.count };
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

/**
 * Deleting a service (or business service) cascades away its subscription picks. A subscriber whose
 * only pick it was would then follow every service on the page, so revoke those subscriptions in the
 * same transaction as the delete instead. Subscribers who also follow something else keep that.
 */
export async function revokeSubscriptionsLosingLastSelection(
  tx: Prisma.TransactionClient,
  target: { serviceId: string } | { businessServiceId: string }
): Promise<number> {
  const only: Prisma.StatusPageSubscriptionWhereInput =
    'serviceId' in target
      ? {
          selectedServices: {
            some: { serviceId: target.serviceId },
            every: { serviceId: target.serviceId },
          },
          selectedBusinessServices: { none: {} },
        }
      : {
          selectedBusinessServices: {
            some: { businessServiceId: target.businessServiceId },
            every: { businessServiceId: target.businessServiceId },
          },
          selectedServices: { none: {} },
        };
  const ids = (await tx.statusPageSubscription.findMany({ where: only, select: { id: true } })).map(
    row => row.id
  );
  if (!ids.length) return 0;
  await tx.statusPageSubscription.updateMany({
    where: { id: { in: ids }, state: { in: REVOCABLE_SUBSCRIPTION_STATES } },
    data: { unsubscribedAt: new Date(), state: 'UNSUBSCRIBED' },
  });
  // Complained/bounced/suppressed rows record the revocation but keep their suppression state.
  await tx.statusPageSubscription.updateMany({
    where: {
      id: { in: ids },
      unsubscribedAt: null,
      state: { notIn: REVOCABLE_SUBSCRIPTION_STATES },
    },
    data: { unsubscribedAt: new Date() },
  });
  await tx.notification.updateMany({
    where: {
      recipientType: 'SUBSCRIBER',
      recipientId: { in: ids },
      status: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      status: 'SKIPPED',
      payloadEncrypted: null,
      errorMsg: 'Subscription was revoked before delivery.',
    },
  });
  return ids.length;
}
