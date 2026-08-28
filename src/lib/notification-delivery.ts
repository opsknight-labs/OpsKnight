import type { IncidentStatus } from '@prisma/client';
import prisma from './prisma';
import { CircuitBreakers } from './circuit-breaker';

export const NOTIFICATION_CHANNELS = [
  'EMAIL',
  'SMS',
  'PUSH',
  'SLACK',
  'WEBHOOK',
  'WHATSAPP',
] as const;
export type NotificationDeliveryChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export interface NotificationRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maximumDelayMs: number;
  pendingTimeoutMs: number;
}

export const NOTIFICATION_RETRY_POLICY: Readonly<NotificationRetryPolicy> = Object.freeze({
  maxAttempts: 3,
  initialDelayMs: 5_000,
  maximumDelayMs: 300_000,
  pendingTimeoutMs: 10 * 60_000,
});

export interface NotificationAttemptResult {
  success: boolean;
  error?: string;
  providerMessageId?: string;
  skipped?: boolean;
}

interface IncidentDeliveryContext {
  status: IncidentStatus;
  service?: { webhookUrl: string | null } | null;
}

export interface NotificationAttemptInput {
  notificationId: string;
  incidentId: string;
  userId: string;
  channel: NotificationDeliveryChannel;
  incident?: IncidentDeliveryContext | null;
}

export function notificationRetryDelayMs(
  attempts: number,
  policy: NotificationRetryPolicy = NOTIFICATION_RETRY_POLICY
): number {
  return Math.min(policy.initialDelayMs * 2 ** Math.max(0, attempts), policy.maximumDelayMs);
}

export function notificationDedupeKey(input: {
  incidentId: string;
  userId: string;
  channel: NotificationDeliveryChannel;
  message: string;
}): string {
  return [input.incidentId, input.userId, input.channel, input.message].join('\u001f');
}

function eventType(status: IncidentStatus | undefined): 'triggered' | 'acknowledged' | 'resolved' {
  return status === 'RESOLVED'
    ? 'resolved'
    : status === 'ACKNOWLEDGED'
      ? 'acknowledged'
      : 'triggered';
}

function unavailablePush(error: string | undefined): boolean {
  const normalized = error?.toLowerCase() ?? '';
  return [
    'no web push subscriptions',
    'no device tokens',
    'disabled by user',
    'user has no phone',
  ].some(message => normalized.includes(message));
}

/** One channel dispatcher shared by first attempts and durable retries. */
export async function dispatchNotificationAttempt(
  input: NotificationAttemptInput
): Promise<NotificationAttemptResult> {
  const incident =
    input.incident ??
    (await prisma.incident.findUnique({
      where: { id: input.incidentId },
      select: { status: true, service: { select: { webhookUrl: true } } },
    }));
  const type = eventType(incident?.status);

  switch (input.channel) {
    case 'EMAIL': {
      const { sendIncidentEmail } = await import('./email');
      return CircuitBreakers.email().execute(async () => {
        const result = await sendIncidentEmail(input.userId, input.incidentId, type);
        if (!result.success) throw new Error(result.error || 'Email delivery failed');
        return result;
      });
    }
    case 'SMS': {
      const { sendIncidentSMS } = await import('./sms');
      return CircuitBreakers.sms().execute(async () => {
        const result = await sendIncidentSMS(
          input.userId,
          input.incidentId,
          type,
          input.notificationId
        );
        if (!result.success) throw new Error(result.error || 'SMS delivery failed');
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'PUSH': {
      const { sendIncidentPush } = await import('./push');
      return CircuitBreakers.push().execute(async () => {
        const result = await sendIncidentPush(input.userId, input.incidentId, type);
        if (result.success) return result;
        if (unavailablePush(result.error)) return { ...result, skipped: true };
        throw new Error(result.error || 'Push delivery failed');
      });
    }
    case 'WEBHOOK': {
      const webhookUrl = incident?.service?.webhookUrl;
      if (!webhookUrl) return { success: false, error: 'No webhook URL configured for service' };
      const { sendIncidentWebhook } = await import('./webhooks');
      return CircuitBreakers.webhook(webhookUrl).execute(async () => {
        const result = await sendIncidentWebhook(webhookUrl, input.incidentId, type);
        if (!result.success) throw new Error(result.error || 'Webhook delivery failed');
        return result;
      });
    }
    case 'WHATSAPP': {
      const { sendIncidentWhatsApp } = await import('./whatsapp');
      return CircuitBreakers.whatsapp().execute(async () => {
        const result = await sendIncidentWhatsApp(
          input.userId,
          input.incidentId,
          type,
          input.notificationId
        );
        if (!result.success) throw new Error(result.error || 'WhatsApp delivery failed');
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'SLACK':
      // Incident Slack delivery is performed by the durable event outbox. This
      // record acknowledges that ownership rather than contacting Slack twice.
      return { success: true, skipped: true };
  }
}
