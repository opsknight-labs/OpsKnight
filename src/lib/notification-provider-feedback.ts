import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { recordUserNotificationEndpointOutcome } from './user-notification-endpoints';

export type ProviderFeedbackType =
  | 'DELIVERED'
  | 'HARD_BOUNCE'
  | 'SOFT_BOUNCE'
  | 'COMPLAINT'
  | 'SUPPRESSION'
  | 'INVALID_RECIPIENT';

export interface ProviderFeedback {
  provider: string;
  providerEventId: string;
  providerMessageId?: string;
  type: ProviderFeedbackType;
  occurredAt: Date;
}

export async function ingestNotificationProviderFeedback(event: ProviderFeedback) {
  let id: string;
  try {
    const stored = await prisma.notificationProviderFeedback.create({
      data: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        providerMessageId: event.providerMessageId,
        eventType: event.type,
        occurredAt: event.occurredAt,
      },
    });
    id = stored.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    return { processed: false, reason: 'duplicate' as const };
  }
  return reconcileFeedback(id);
}

async function reconcileFeedback(id: string) {
  return prisma.$transaction(async tx => {
    // Lock the durable event: concurrent worker/webhook replay must apply counters once.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "NotificationProviderFeedback" WHERE id = ${id}
      AND "processedAt" IS NULL FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return { processed: false, reason: 'duplicate' as const };
    const stored = await tx.notificationProviderFeedback.findUniqueOrThrow({ where: { id } });
    const event = { ...stored, type: stored.eventType as ProviderFeedbackType };
    if (!event.providerMessageId) {
      await tx.notificationProviderFeedback.update({
        where: { id },
        data: { processedAt: new Date() },
      });
      return { processed: true, subscriptionId: null };
    }
    const notification = await tx.notification.findUnique({
      where: { providerMessageId: event.providerMessageId },
      select: {
        id: true,
        deliveryProvider: true,
        attempts: true,
        maxAttempts: true,
        sourceType: true,
        templateKey: true,
        recipientType: true,
        recipientId: true,
        userId: true,
        channel: true,
        recipientHash: true,
      },
    });
    const attempt =
      notification && !notification.deliveryProvider
        ? await tx.notificationDeliveryAttempt.findFirst({
            where: { notificationId: notification.id, providerMessageId: event.providerMessageId },
            orderBy: { ordinal: 'desc' },
            select: { provider: true },
          })
        : null;
    if (!notification || (notification.deliveryProvider ?? attempt?.provider) !== event.provider) {
      await tx.notificationProviderFeedback.update({
        where: { id },
        data: {
          nextReconcileAt: new Date(Date.now() + 60_000),
        },
      });
      return { processed: false, reason: 'unmatched' as const };
    }
    // Serialize distinct receipts for the same notification as well.
    await tx.$queryRaw`SELECT id FROM "Notification" WHERE id = ${notification.id} FOR UPDATE`;
    await tx.notificationProviderFeedback.update({
      where: { id },
      data: { processedAt: new Date() },
    });
    if (
      notification?.sourceType === 'AUTHENTICATION' &&
      notification.templateKey === 'authentication-security-alert'
    ) {
      const current = await tx.notification.findUniqueOrThrow({
        where: { id: notification.id },
        select: { status: true, attempts: true, maxAttempts: true },
      });
      // A late delivery callback cannot revive a terminally failed transport or endpoint.
      if (
        event.type === 'DELIVERED' &&
        current.status === 'FAILED' &&
        current.attempts >= current.maxAttempts
      ) {
        return { processed: true, subscriptionId: null };
      }
      if (event.type === 'DELIVERED') {
        const updated = await tx.notification.updateMany({
          where: { id: notification.id, status: { in: ['PENDING', 'SENT', 'UNKNOWN'] } },
          data: { status: 'DELIVERED', deliveredAt: event.occurredAt },
        });
        if (updated.count)
          await tx.authenticationAlert.updateMany({
            where: { notificationId: notification.id, failedAt: null, cancelledAt: null },
            data: { deliveredAt: event.occurredAt, lastError: null },
          });
      } else if (
        ['HARD_BOUNCE', 'INVALID_RECIPIENT', 'COMPLAINT', 'SUPPRESSION'].includes(event.type)
      ) {
        await tx.notification.updateMany({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            deliveredAt: null,
            attempts: Math.max(notification.attempts, notification.maxAttempts),
            failedAt: event.occurredAt,
            payloadEncrypted: null,
          },
        });
        await tx.authenticationAlert.updateMany({
          where: { notificationId: notification.id, cancelledAt: null },
          data: {
            failedAt: event.occurredAt,
            deliveredAt: null,
            lastError:
              'Provider reported terminal delivery failure. Review provider feedback before retrying.',
          },
        });
      }
    }
    if (notification?.userId) {
      const terminalStatus =
        event.type === 'HARD_BOUNCE'
          ? 'BOUNCED'
          : event.type === 'INVALID_RECIPIENT'
            ? 'INVALID'
            : event.type === 'COMPLAINT' || event.type === 'SUPPRESSION'
              ? 'OPTED_OUT'
              : undefined;
      await recordUserNotificationEndpointOutcome(tx, {
        userId: notification.userId,
        channel: notification.channel,
        addressHash: notification.recipientHash,
        delivered: event.type === 'DELIVERED',
        errorCode: event.type === 'DELIVERED' ? undefined : event.type,
        terminalStatus,
        occurredAt: event.occurredAt,
      });
    }
    if (notification?.recipientType !== 'SUBSCRIBER' || !notification.recipientId) {
      return { processed: true, subscriptionId: null };
    }
    const subscriptionId = notification.recipientId;
    if (event.type === 'DELIVERED') {
      await tx.statusPageSubscription.updateMany({
        where: { id: subscriptionId },
        data: { lastDeliveredAt: event.occurredAt },
      });
    } else if (event.type === 'SOFT_BOUNCE') {
      const subscription = await tx.statusPageSubscription.update({
        where: { id: subscriptionId },
        data: {
          lastBounceAt: event.occurredAt,
          lastFailedAt: event.occurredAt,
          bounceCount: { increment: 1 },
        },
        select: { bounceCount: true },
      });
      if (subscription.bounceCount >= 3) {
        await tx.statusPageSubscription.update({
          where: { id: subscriptionId },
          data: { state: 'BOUNCED', suppressionReason: 'Repeated soft bounce' },
        });
      }
    } else {
      const state =
        event.type === 'COMPLAINT'
          ? 'COMPLAINED'
          : event.type === 'HARD_BOUNCE'
            ? 'BOUNCED'
            : 'SUPPRESSED';
      await tx.statusPageSubscription.updateMany({
        where: { id: subscriptionId },
        data: {
          state,
          suppressionReason: event.type,
          lastFailedAt: event.occurredAt,
          ...(event.type === 'COMPLAINT' ? { complainedAt: event.occurredAt } : {}),
          ...(event.type === 'HARD_BOUNCE'
            ? { lastBounceAt: event.occurredAt, bounceCount: { increment: 1 } }
            : {}),
        },
      });
    }
    return { processed: true, subscriptionId };
  });
}

/** Indexed, bounded replay; unmatched rows yield for a minute to avoid starving later receipts. */
export async function reconcileNotificationProviderFeedback(
  notificationId?: string,
  now = new Date()
) {
  const notification = notificationId
    ? await prisma.notification.findUnique({
        where: { id: notificationId },
        select: { providerMessageId: true },
      })
    : null;
  if (notificationId && !notification?.providerMessageId) return;
  const rows = await prisma.notificationProviderFeedback.findMany({
    where: {
      processedAt: null,
      ...(notificationId
        ? { providerMessageId: notification!.providerMessageId }
        : { nextReconcileAt: { lte: now } }),
    },
    orderBy: { nextReconcileAt: 'asc' },
    take: 100,
    select: { id: true },
  });
  for (const row of rows) await reconcileFeedback(row.id);
}
