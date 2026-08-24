import { Incident, Service } from '@prisma/client';
import prisma from './prisma';
import { sendIncidentEmail } from './email';
import { CircuitBreakers, CircuitBreakerError } from './circuit-breaker';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'SLACK' | 'WEBHOOK' | 'WHATSAPP';

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
    let result: { success: boolean; error?: string; messageSid?: string };

    // Route to appropriate notification service with circuit breaker protection
    // Circuit breakers prevent cascade failures when external services are slow/down
    switch (channel) {
      case 'EMAIL':
        // Determine event type from message or incident status
        // Use passed incident if available, otherwise fetch
        const incidentData =
          incident || (await prisma.incident.findUnique({ where: { id: incidentId } }));
        const eventType =
          incidentData?.status === 'RESOLVED'
            ? 'resolved'
            : incidentData?.status === 'ACKNOWLEDGED'
              ? 'acknowledged'
              : 'triggered';
        // Use circuit breaker to prevent cascade failures
        result = await CircuitBreakers.email().execute(async () => {
          const res = await sendIncidentEmail(userId, incidentId, eventType);
          if (!res.success) {
            throw new Error(res.error || 'Email delivery failed');
          }
          return res;
        });
        break;

      case 'SMS':
        const { sendIncidentSMS } = await import('./sms');
        const incidentForSMS =
          incident || (await prisma.incident.findUnique({ where: { id: incidentId } }));
        const eventTypeSMS =
          incidentForSMS?.status === 'RESOLVED'
            ? 'resolved'
            : incidentForSMS?.status === 'ACKNOWLEDGED'
              ? 'acknowledged'
              : 'triggered';
        result = await CircuitBreakers.sms().execute(async () => {
          const res = await sendIncidentSMS(userId, incidentId, eventTypeSMS, notification.id);
          if (!res.success) {
            throw new Error(res.error || 'SMS delivery failed');
          }
          return res;
        });
        break;

      case 'PUSH':
        const { sendIncidentPush } = await import('./push');
        const incidentForPush =
          incident || (await prisma.incident.findUnique({ where: { id: incidentId } }));
        const eventTypePush =
          incidentForPush?.status === 'RESOLVED'
            ? 'resolved'
            : incidentForPush?.status === 'ACKNOWLEDGED'
              ? 'acknowledged'
              : 'triggered';
        result = await CircuitBreakers.push().execute(async () => {
          const res = await sendIncidentPush(userId, incidentId, eventTypePush);
          if (!res.success) {
            const err = (res.error || '').toLowerCase();
            if (
              err.includes('no web push subscriptions') ||
              err.includes('no device tokens') ||
              err.includes('disabled by user') ||
              err.includes('user has no phone')
            ) {
              return { success: false, skipped: true, error: res.error };
            }
            throw new Error(res.error || 'Push delivery failed');
          }
          return res;
        });
        break;

      case 'SLACK':
        // Slack is handled separately via slack.ts
        result = { success: true };
        break;

      case 'WEBHOOK':
        // Webhooks are typically configured per-service or per-escalation-policy
        // For now, we'll need the webhook URL from the escalation policy or service
        // This is a placeholder - webhook URLs should be stored in escalation policy config
        const { sendIncidentWebhook } = await import('./webhooks');
        // Webhooks need service relation
        const incidentForWebhook =
          incident && incident.service
            ? incident
            : await prisma.incident.findUnique({
                where: { id: incidentId },
                include: { service: true },
              });

        if (!incidentForWebhook || !incidentForWebhook.service) {
          result = { success: false, error: 'Incident or Service not found' };
          break;
        }

        // Try to get webhook URL from service or escalation policy
        // For now, we'll check if there's a webhook URL in the service config
        // In a full implementation, this would come from the escalation policy
        const webhookUrl = incidentForWebhook.service.webhookUrl;

        if (!webhookUrl) {
          result = { success: false, error: 'No webhook URL configured for this service' };
          break;
        }

        const eventTypeWebhook =
          incidentForWebhook.status === 'RESOLVED'
            ? 'resolved'
            : incidentForWebhook.status === 'ACKNOWLEDGED'
              ? 'acknowledged'
              : 'triggered';

        const webhookResult = await sendIncidentWebhook(webhookUrl, incidentId, eventTypeWebhook);

        result = webhookResult.success
          ? { success: true }
          : { success: false, error: webhookResult.error };
        break;

      case 'WHATSAPP':
        const { sendIncidentWhatsApp } = await import('./whatsapp');
        const incidentForWhatsApp =
          incident || (await prisma.incident.findUnique({ where: { id: incidentId } }));
        const eventTypeWhatsApp =
          incidentForWhatsApp?.status === 'RESOLVED'
            ? 'resolved'
            : incidentForWhatsApp?.status === 'ACKNOWLEDGED'
              ? 'acknowledged'
              : 'triggered';
        result = await CircuitBreakers.whatsapp().execute(async () => {
          const res = await sendIncidentWhatsApp(
            userId,
            incidentId,
            eventTypeWhatsApp,
            notification.id
          );
          if (!res.success) {
            throw new Error(res.error || 'WhatsApp delivery failed');
          }
          return res;
        });
        break;

      default:
        result = { success: false, error: `Unknown channel: ${channel}` };
    }

    if (result.success) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.messageSid,
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
      throw new Error((result as any).error || 'Notification delivery failed');
    }
  } catch (error: any) {
    // Handle circuit breaker errors specially - don't count as attempt failure
    const isCircuitOpen = error instanceof CircuitBreakerError;
    const errorMessage = isCircuitOpen
      ? `Service unavailable (circuit open): ${error.serviceName}`
      : error.message;

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
