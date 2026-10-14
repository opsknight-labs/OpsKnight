import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { logger } from './logger';
import { recordUserNotificationEndpointOutcome } from './user-notification-endpoints';

const MAX_RECONCILIATION_ATTEMPTS = 12;
const MAX_RECEIPT_AGE_MS = 24 * 60 * 60_000;
const RETENTION_MS = 90 * 24 * 60 * 60_000;
const REPLAY_BUDGET_MS = 2_000;

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
  return safelyReconcileFeedback(id);
}

async function reconcileFeedback(id: string, now = new Date()) {
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '750ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
      // Lock the durable event: concurrent worker/webhook replay must apply counters once.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "NotificationProviderFeedback" WHERE id = ${id}
      AND "processedAt" IS NULL AND "quarantinedAt" IS NULL FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return { processed: false, reason: 'duplicate' as const };
      const stored = await tx.notificationProviderFeedback.findUniqueOrThrow({ where: { id } });
      await tx.notificationProviderFeedback.update({
        where: { id },
        data: {
          reconciliationAttempts: { increment: 1 },
        },
      });
      if (
        ![
          'DELIVERED',
          'HARD_BOUNCE',
          'SOFT_BOUNCE',
          'COMPLAINT',
          'SUPPRESSION',
          'INVALID_RECIPIENT',
        ].includes(stored.eventType)
      ) {
        await tx.notificationProviderFeedback.update({
          where: { id },
          data: {
            quarantinedAt: now,
            reconciliationReason: 'INVALID_EVENT_TYPE',
          },
        });
        return { processed: false, reason: 'quarantined' as const };
      }
      const event = { ...stored, type: stored.eventType as ProviderFeedbackType };
      if (!event.providerMessageId) {
        await tx.notificationProviderFeedback.update({
          where: { id },
          data: { processedAt: now, reconciliationReason: null },
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
              where: {
                notificationId: notification.id,
                providerMessageId: event.providerMessageId,
              },
              orderBy: { ordinal: 'desc' },
              select: { provider: true },
            })
          : null;
      if (
        !notification ||
        (notification.deliveryProvider ?? attempt?.provider) !== event.provider
      ) {
        await tx.notificationProviderFeedback.update({
          where: { id },
          data: {
            nextReconcileAt: new Date(
              now.getTime() +
                Math.min(60_000 * 2 ** Math.min(stored.reconciliationAttempts, 12), 60 * 60_000)
            ),
            reconciliationReason: 'UNMATCHED_PROVIDER_MESSAGE',
            ...(stored.reconciliationAttempts + 1 >= MAX_RECONCILIATION_ATTEMPTS ||
            now.getTime() - stored.createdAt.getTime() >= MAX_RECEIPT_AGE_MS
              ? { quarantinedAt: now }
              : {}),
          },
        });
        return { processed: false, reason: 'unmatched' as const };
      }
      // Serialize distinct receipts for the same notification as well.
      await tx.$queryRaw`SELECT id FROM "Notification" WHERE id = ${notification.id} FOR UPDATE`;
      if (notification.recipientType === 'SUBSCRIBER' && notification.recipientId) {
        // Lock the target so deletion cannot race the soft-bounce counter update.
        const targets = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "StatusPageSubscription" WHERE id = ${notification.recipientId} FOR UPDATE`;
        if (!targets.length) {
          await tx.notificationProviderFeedback.update({
            where: { id },
            data: {
              processedAt: null,
              quarantinedAt: now,
              reconciliationReason: 'RECIPIENT_DELETED',
            },
          });
          return { processed: false, reason: 'quarantined' as const };
        }
      }
      await tx.notificationProviderFeedback.update({
        where: { id },
        data: { processedAt: now, reconciliationReason: null },
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
    },
    { maxWait: 500, timeout: 1_000 }
  );
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
      quarantinedAt: null,
      ...(notificationId
        ? { providerMessageId: notification!.providerMessageId }
        : { nextReconcileAt: { lte: now } }),
    },
    orderBy: { nextReconcileAt: 'asc' },
    take: 100,
    select: { id: true },
  });
  const deadline = Date.now() + REPLAY_BUDGET_MS;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    await safelyReconcileFeedback(row.id, now);
  }
}

async function safelyReconcileFeedback(id: string, now = new Date()) {
  try {
    return await reconcileFeedback(id, now);
  } catch {
    // Do not expose database error text or recipient metadata in logs/evidence.
    logger.warn('notification.feedback_reconciliation_failed', { feedbackId: id });
    try {
      await prisma.$transaction(
        async tx => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '750ms'`;
          await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
          const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "NotificationProviderFeedback" WHERE id = ${id}
          AND "processedAt" IS NULL AND "quarantinedAt" IS NULL FOR UPDATE SKIP LOCKED`;
          if (!rows.length) return;
          const row = await tx.notificationProviderFeedback.findUniqueOrThrow({ where: { id } });
          const attempts = row.reconciliationAttempts + 1;
          await tx.notificationProviderFeedback.update({
            where: { id },
            data: {
              reconciliationAttempts: attempts,
              reconciliationReason: 'RECONCILIATION_ERROR',
              nextReconcileAt: new Date(
                now.getTime() + Math.min(60_000 * 2 ** Math.min(attempts, 12), 60 * 60_000)
              ),
            },
          });
        },
        { maxWait: 500, timeout: 1_000 }
      );
    } catch {
      logger.warn('notification.feedback_retry_persistence_failed', { feedbackId: id });
    }
    return { processed: false, reason: 'deferred' as const };
  }
}

/** Bounded indexed cleanup preserves terminal evidence for 90 days. */
export async function cleanNotificationProviderFeedback(now = new Date()) {
  const before = new Date(now.getTime() - RETENTION_MS);
  for (const field of ['processedAt', 'quarantinedAt'] as const) {
    const rows = await prisma.notificationProviderFeedback.findMany({
      where: { [field]: { lt: before } },
      orderBy: { [field]: 'asc' },
      take: 100,
      select: { id: true },
    });
    if (rows.length)
      await prisma.notificationProviderFeedback.deleteMany({
        where: { id: { in: rows.map(row => row.id) }, [field]: { lt: before } },
      });
  }
}
