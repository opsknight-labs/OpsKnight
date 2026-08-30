import type { IncidentStatus } from '@prisma/client';
import prisma from './prisma';
import { CircuitBreakerError, CircuitBreakers } from './circuit-breaker';

export const NOTIFICATION_CHANNELS = [
  'EMAIL',
  'SMS',
  'PUSH',
  'SLACK',
  'WEBHOOK',
  'WHATSAPP',
] as const;
export type NotificationDeliveryChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = [
  'PENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SKIPPED',
] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];
export const NOTIFICATION_EVENT_TYPES = [
  'triggered',
  'acknowledged',
  'resolved',
  'updated',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
export type NotificationDeliveryOutcome =
  | 'DELIVERED'
  | 'SKIPPED'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'CIRCUIT_OPEN';

/**
 * The durable outbox uses this contract to decide whether a notification job
 * completed, should be retried, or has reached a terminal state. Policy
 * decisions such as quiet hours and no enabled channels are successful skips,
 * not delivery failures.
 */
export interface NotificationDeliveryResult {
  success: boolean;
  outcome: NotificationDeliveryOutcome;
  errors?: string[];
  error?: string;
}

export function isRetryableNotificationOutcome(outcome: NotificationDeliveryOutcome): boolean {
  return outcome === 'RETRYABLE_FAILURE' || outcome === 'CIRCUIT_OPEN';
}

function providerFailureResult(result: {
  success: boolean;
  error?: string;
  retryable?: boolean;
}): NotificationAttemptResult {
  return {
    success: false,
    outcome: result.retryable === false ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
    error: result.error || 'Notification delivery failed',
  };
}

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
  outcome: NotificationDeliveryOutcome;
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
  eventType: NotificationEventType;
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

export function notificationEventTypeFromStatus(
  status: IncidentStatus | undefined
): Exclude<NotificationEventType, 'updated'> {
  return status === 'RESOLVED'
    ? 'resolved'
    : status === 'ACKNOWLEDGED'
      ? 'acknowledged'
      : 'triggered';
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
  const type = input.eventType;

  try {
    switch (input.channel) {
      case 'EMAIL': {
        const { sendIncidentEmail } = await import('./email');
        return await CircuitBreakers.email().execute(async () => {
          const result = await sendIncidentEmail(input.userId, input.incidentId, type);
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED' };
        });
      }
      case 'SMS': {
        const { sendIncidentSMS } = await import('./sms');
        return await CircuitBreakers.sms().execute(async () => {
          const result = await sendIncidentSMS(
            input.userId,
            input.incidentId,
            type,
            input.notificationId
          );
          if (!result.success) return providerFailureResult(result);
          return {
            ...result,
            success: true,
            outcome: 'DELIVERED',
            providerMessageId: result.messageSid,
          };
        });
      }
      case 'PUSH': {
        const { sendIncidentPush } = await import('./push');
        return await CircuitBreakers.push().execute(async () => {
          const result = await sendIncidentPush(input.userId, input.incidentId, type);
          if (result.success) return { ...result, success: true, outcome: 'DELIVERED' };
          if (result.code === 'NO_DEVICE_TOKENS' || result.code === 'NO_WEB_SUBSCRIPTIONS') {
            return { ...result, outcome: 'SKIPPED', skipped: true };
          }
          return providerFailureResult(result);
        });
      }
      case 'WEBHOOK': {
        const webhookUrl = incident?.service?.webhookUrl;
        if (!webhookUrl) {
          return {
            success: false,
            outcome: 'PERMANENT_FAILURE',
            error: 'No webhook URL configured for service',
          };
        }
        const { sendIncidentWebhook } = await import('./webhooks');
        return await CircuitBreakers.webhook(webhookUrl).execute(async () => {
          const result = await sendIncidentWebhook(webhookUrl, input.incidentId, type);
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED' };
        });
      }
      case 'WHATSAPP': {
        const { sendIncidentWhatsApp } = await import('./whatsapp');
        return await CircuitBreakers.whatsapp().execute(async () => {
          const result = await sendIncidentWhatsApp(
            input.userId,
            input.incidentId,
            type,
            input.notificationId
          );
          if (!result.success) return providerFailureResult(result);
          return {
            ...result,
            success: true,
            outcome: 'DELIVERED',
            providerMessageId: result.messageSid,
          };
        });
      }
      case 'SLACK':
        // Incident Slack delivery is performed by the durable event outbox. This
        // record acknowledges that ownership rather than contacting Slack twice.
        return { success: true, outcome: 'SKIPPED', skipped: true };
    }
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      return {
        success: false,
        outcome: 'CIRCUIT_OPEN',
        error: `Service unavailable (circuit open): ${error.serviceName}`,
      };
    }
    if (error instanceof Error && 'retryable' in error && error.retryable === false) {
      return {
        success: false,
        outcome: 'PERMANENT_FAILURE',
        error: error.message,
      };
    }
    return {
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
