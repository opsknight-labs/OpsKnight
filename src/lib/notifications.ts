import { Incident, Service } from '@prisma/client';
import prisma from './prisma';
import { CircuitBreakerError } from './circuit-breaker';
import {
  dispatchNotificationAttempt,
  NOTIFICATION_CHANNELS,
  type NotificationDeliveryChannel,
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
  incident?: Incident & { service?: Service | null }
) {
  if (!NOTIFICATION_CHANNELS.includes(channel)) {
    return { success: false, error: `Unknown channel: ${String(channel)}` };
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
      incident,
    });

    if (result.success) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
        },
      });

      // Fetch recipient details for attribution
      const recipient = prisma.user?.findUnique
        ? await prisma.user
            .findUnique({
              where: { id: userId },
              select: { name: true, email: true },
            })
            .catch(() => null)
        : null;
      const recipientName = recipient?.name || recipient?.email || userId;

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

      return { success: true, notificationId: notification.id };
    } else {
      throw new Error(result.error || 'Notification delivery failed');
    }
  } catch (error: unknown) {
    // Handle circuit breaker errors specially - don't count as attempt failure
    const isCircuitOpen = error instanceof CircuitBreakerError;
    const errorMessage = isCircuitOpen
      ? `Service unavailable (circuit open): ${error.serviceName}`
      : error instanceof Error
        ? error.message
        : String(error);

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: errorMessage,
        // Don't increment attempts for circuit breaker failures (will retry when circuit closes)
        attempts: isCircuitOpen ? notification.attempts : (notification.attempts || 0) + 1,
      },
    });

    return {
      success: false,
      error: errorMessage,
      notificationId: notification.id,
      circuitOpen: isCircuitOpen,
    };
  }
}

/**
 * Execute escalation policy for an incident.
 * Re-exported from escalation.ts for backward compatibility
 */
export { executeEscalation } from './escalation';
