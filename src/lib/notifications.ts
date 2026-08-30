import { Incident, Service } from '@prisma/client';
import prisma from './prisma';
import {
  dispatchNotificationAttempt,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RETRY_POLICY,
  type NotificationDeliveryChannel,
  type NotificationEventType,
} from './notification-delivery';

export type NotificationChannel = NotificationDeliveryChannel;

/**
 * Send notifications to escalation policy targets for an incident.
 */
/**
 * Send notifications to escalation policy targets for an incident.
 * @param incident - Optional pre-fetched incident object to avoid extra DB queries
 */
export async function sendNotification(
  incidentId: string,
  userId: string,
  channel: NotificationChannel,
  message: string,
  incident?: Incident & { service?: Service | null },
  eventType: NotificationEventType = 'triggered'
) {
  if (!NOTIFICATION_CHANNELS.includes(channel)) {
    return {
      success: false,
      outcome: 'PERMANENT_FAILURE' as const,
      error: `Unknown channel: ${String(channel)}`,
    };
  }

  // Responder eligibility is security- and correctness-sensitive. Validate it
  // at the central delivery boundary so every caller (web, REST, escalation,
  // bulk jobs, retries) fails closed even if an upstream adapter is stale.
  const recipient = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!recipient || recipient.status !== 'ACTIVE') {
    return {
      success: false,
      skipped: true,
      terminal: true,
      error: 'Notification recipient is not an active user.',
    };
  }

  // Check for duplicate pending/sent notification with the same payload within debounce window (60s)
  if (typeof prisma.notification?.findFirst === 'function') {
    const debounceWindow = new Date(Date.now() - 60_000);
    const existingNotification = await prisma.notification.findFirst({
      where: {
        incidentId,
        userId,
        channel,
        message,
        status: { in: ['SENT', 'PENDING'] },
        createdAt: { gte: debounceWindow },
      },
      select: { id: true },
    });

    if (existingNotification) {
      return {
        success: true,
        outcome: 'DELIVERED' as const,
        notificationId: existingNotification.id,
        debounced: true,
      };
    }
  }

  // Create notification record
  const notification = await prisma.notification.create({
    data: {
      incidentId,
      userId,
      channel,
      message,
      eventType,
      status: 'PENDING',
      attempts: 0,
    },
  });

  try {
    const result = await dispatchNotificationAttempt({
      notificationId: notification.id,
      incidentId,
      userId,
      channel,
      eventType,
      incident,
    });

    if (result.outcome === 'DELIVERED') {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
        },
      });

      // Fetch recipient details for attribution
      const recipientDetails = prisma.user?.findUnique
        ? await prisma.user
            .findUnique({
              where: { id: userId },
              select: { name: true, email: true },
            })
            .catch(() => null)
        : null;
      const recipientName = recipientDetails?.name || recipientDetails?.email || userId;

      // Log to incident timeline
      try {
        if (prisma.incidentEvent?.create) {
          await prisma.incidentEvent.create({
            data: {
              incidentId,
              type: 'STATUS_CHANGE',
              message: `Notification sent to ${recipientName} via ${channel}`,
            },
          });
        }
      } catch (_) {}

      return { success: true, outcome: 'DELIVERED' as const, notificationId: notification.id };
    }

    if (result.outcome === 'SKIPPED') {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SKIPPED',
          errorMsg: result.error || 'Delivery skipped by notification policy.',
        },
      });
      return {
        success: true,
        outcome: 'SKIPPED' as const,
        skipped: true,
        terminal: true,
        error: result.error,
        notificationId: notification.id,
      };
    }

    const circuitOpen = result.outcome === 'CIRCUIT_OPEN';
    const permanentFailure = result.outcome === 'PERMANENT_FAILURE';
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: result.error || 'Notification delivery failed',
        attempts: circuitOpen
          ? notification.attempts
          : permanentFailure
            ? NOTIFICATION_RETRY_POLICY.maxAttempts
            : (notification.attempts || 0) + 1,
      },
    });
    return {
      success: false,
      outcome: result.outcome,
      terminal: permanentFailure,
      circuitOpen,
      error: result.error || 'Notification delivery failed',
      notificationId: notification.id,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: errorMessage,
        attempts: (notification.attempts || 0) + 1,
      },
    });

    return {
      success: false,
      outcome: 'RETRYABLE_FAILURE' as const,
      error: errorMessage,
      notificationId: notification.id,
      circuitOpen: false,
    };
  }
}

/**
 * Execute escalation policy for an incident.
 * Re-exported from escalation.ts for backward compatibility
 */
export { executeEscalation } from './escalation';