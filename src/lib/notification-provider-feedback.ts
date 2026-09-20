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
  return prisma.$transaction(async tx => {
    try {
      await tx.notificationProviderFeedback.create({
        data: {
          provider: event.provider,
          providerEventId: event.providerEventId,
          providerMessageId: event.providerMessageId,
          eventType: event.type,
          occurredAt: event.occurredAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { processed: false, reason: 'duplicate' as const };
      }
      throw error;
    }
    if (!event.providerMessageId) return { processed: true, subscriptionId: null };
    const notification = await tx.notification.findUnique({
      where: { providerMessageId: event.providerMessageId },
      select: { recipientType: true, recipientId: true, userId: true, channel: true, recipientHash: true },
    });
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
    const id = notification.recipientId;
    if (event.type === 'DELIVERED') {
      await tx.statusPageSubscription.updateMany({ where: { id }, data: { lastDeliveredAt: event.occurredAt } });
    } else if (event.type === 'SOFT_BOUNCE') {
      const subscription = await tx.statusPageSubscription.update({
        where: { id }, data: { lastBounceAt: event.occurredAt, lastFailedAt: event.occurredAt, bounceCount: { increment: 1 } },
        select: { bounceCount: true },
      });
      if (subscription.bounceCount >= 3) {
        await tx.statusPageSubscription.update({ where: { id }, data: { state: 'BOUNCED', suppressionReason: 'Repeated soft bounce' } });
      }
    } else {
      const state = event.type === 'COMPLAINT' ? 'COMPLAINED' : event.type === 'HARD_BOUNCE' ? 'BOUNCED' : 'SUPPRESSED';
      await tx.statusPageSubscription.updateMany({ where: { id }, data: {
        state,
        suppressionReason: event.type,
        lastFailedAt: event.occurredAt,
        ...(event.type === 'COMPLAINT' ? { complainedAt: event.occurredAt } : {}),
        ...(event.type === 'HARD_BOUNCE' ? { lastBounceAt: event.occurredAt, bounceCount: { increment: 1 } } : {}),
      } });
    }
    return { processed: true, subscriptionId: id };
  });
}
