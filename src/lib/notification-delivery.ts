import type { IncidentStatus } from '@prisma/client';
import prisma from './prisma';
import { CircuitBreakerError, CircuitBreakers } from './circuit-breaker';
import { notificationIntentEventAt } from './notification-identity';
import { acquireProviderAdmission, type ProviderAdmissionScope } from './provider-admission';

export const NOTIFICATION_CHANNELS = ['EMAIL','SMS','PUSH','SLACK','WEBHOOK','WHATSAPP'] as const;
export type NotificationDeliveryChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING','SENT','DELIVERED','FAILED','SKIPPED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];
export const NOTIFICATION_EVENT_TYPES = ['triggered','acknowledged','resolved','updated'] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
export type NotificationDeliveryOutcome = 'DELIVERED' | 'QUEUED' | 'SKIPPED' | 'RETRYABLE_FAILURE' | 'PERMANENT_FAILURE' | 'CIRCUIT_OPEN';

export interface NotificationDeliveryResult { success: boolean; outcome: NotificationDeliveryOutcome; errors?: string[]; error?: string; }
export function isRetryableNotificationOutcome(outcome: NotificationDeliveryOutcome): boolean {
  return outcome === 'RETRYABLE_FAILURE' || outcome === 'CIRCUIT_OPEN';
}

/** Compatibility key used by the legacy in-memory queue during rolling upgrades. */
export function notificationDedupeKey(input: {
  incidentId: string;
  userId: string;
  channel: NotificationDeliveryChannel;
  message: string;
}): string {
  return [input.incidentId, input.userId, input.channel, input.message].join('\u001f');
}

function providerFailureResult(result: { success: boolean; error?: string; retryable?: boolean }): NotificationAttemptResult {
  return { success: false, outcome: result.retryable === false ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE', error: result.error || 'Notification delivery failed' };
}
export interface NotificationRetryPolicy { maxAttempts: number; initialDelayMs: number; maximumDelayMs: number; pendingTimeoutMs: number; }
export const NOTIFICATION_RETRY_POLICY: Readonly<NotificationRetryPolicy> = Object.freeze({ maxAttempts: 3, initialDelayMs: 5_000, maximumDelayMs: 300_000, pendingTimeoutMs: 2 * 60_000 });
export interface NotificationAttemptResult { success: boolean; outcome: NotificationDeliveryOutcome; error?: string; providerMessageId?: string; skipped?: boolean; }
interface IncidentDeliveryContext { status: IncidentStatus; createdAt?: Date; updatedAt?: Date; acknowledgedAt?: Date | null; resolvedAt?: Date | null; service?: { webhookUrl: string | null } | null; }
export interface NotificationAttemptInput { notificationId: string; incidentId: string; userId: string; channel: NotificationDeliveryChannel; eventType: NotificationEventType; message?: string | null; incident?: IncidentDeliveryContext | null; }
export function notificationRetryDelayMs(attempts: number, policy: NotificationRetryPolicy = NOTIFICATION_RETRY_POLICY): number { return Math.min(policy.initialDelayMs * 2 ** Math.max(0, attempts), policy.maximumDelayMs); }
export function notificationEventTypeFromStatus(status: IncidentStatus | undefined): Exclude<NotificationEventType, 'updated'> { return status === 'RESOLVED' ? 'resolved' : status === 'ACKNOWLEDGED' ? 'acknowledged' : 'triggered'; }

function staleIntentReason(input: NotificationAttemptInput, incident: IncidentDeliveryContext | null): string | null {
  if (!incident) return null;
  const expectedAt = notificationIntentEventAt(input.notificationId)?.getTime() ?? null;
  if (input.eventType === 'triggered') return incident.status === 'OPEN' ? null : `Triggered notification superseded by incident state ${incident.status}`;
  if (input.eventType === 'acknowledged') {
    if (incident.status === 'RESOLVED') return 'Acknowledged notification superseded by incident resolution';
    if (expectedAt && incident.acknowledgedAt?.getTime() !== expectedAt) return 'Acknowledged notification belongs to a superseded lifecycle generation';
    return null;
  }
  if (input.eventType === 'resolved') {
    if (incident.status !== 'RESOLVED') return `Resolved notification superseded by incident state ${incident.status}`;
    if (expectedAt && incident.resolvedAt?.getTime() !== expectedAt) return 'Resolved notification belongs to a superseded lifecycle generation';
    return null;
  }
  if (expectedAt && incident.updatedAt?.getTime() !== expectedAt) return 'Incident update notification superseded by a newer incident revision';
  return null;
}

async function providerAdmission(input: NotificationAttemptInput, incident: IncidentDeliveryContext): Promise<NotificationAttemptResult | null> {
  if (input.channel === 'SLACK') return null;
  const scope = input.channel as ProviderAdmissionScope;
  let providerKey = 'default';
  if (input.channel === 'WEBHOOK' && incident.service?.webhookUrl) {
    try { providerKey = new URL(incident.service.webhookUrl).origin; } catch { providerKey = 'service-webhook'; }
  }
  const admission = await acquireProviderAdmission(scope, providerKey);
  if (admission.allowed) return null;
  return {
    success: true,
    outcome: 'QUEUED',
    error: `Provider admission deferred until ${admission.retryAt.toISOString()}`,
  };
}

export async function dispatchNotificationAttempt(input: NotificationAttemptInput): Promise<NotificationAttemptResult> {
  const incident = input.incident ?? (await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { status: true, createdAt: true, updatedAt: true, acknowledgedAt: true, resolvedAt: true, service: { select: { webhookUrl: true } } },
  }));
  const type = input.eventType;
  if (!incident) return { success: false, outcome: 'PERMANENT_FAILURE', error: 'Incident not found' };
  const staleReason = staleIntentReason(input, incident);
  if (staleReason) return { success: true, outcome: 'SKIPPED', skipped: true, error: staleReason };
  const deferred = await providerAdmission(input, incident);
  if (deferred) return deferred;

  try {
    switch (input.channel) {
      case 'EMAIL': {
        const { sendIncidentEmail } = await import('./email');
        return await CircuitBreakers.email().execute(async () => {
          const result = await sendIncidentEmail(input.userId, input.incidentId, type, input.notificationId, input.message ?? undefined);
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED' };
        });
      }
      case 'SMS': {
        const { sendIncidentSMS } = await import('./sms');
        return await CircuitBreakers.sms().execute(async () => {
          const result = await sendIncidentSMS(input.userId, input.incidentId, type, input.notificationId);
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED', providerMessageId: result.messageSid };
        });
      }
      case 'PUSH': {
        const { sendNotificationIntentPush } = await import('./incident-push-delivery');
        return await CircuitBreakers.push().execute(async () => {
          const result = await sendNotificationIntentPush(input.userId, input.incidentId, type, input.message, input.notificationId);
          if (result.success) return { ...result, success: true, outcome: 'DELIVERED' };
          if (result.code === 'NO_DEVICE_TOKENS' || result.code === 'NO_WEB_SUBSCRIPTIONS') return { ...result, outcome: 'SKIPPED', skipped: true };
          return providerFailureResult(result);
        });
      }
      case 'WEBHOOK': {
        const webhookUrl = incident.service?.webhookUrl;
        if (!webhookUrl) return { success: false, outcome: 'PERMANENT_FAILURE', error: 'No webhook URL configured for service' };
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
          const result = await sendIncidentWhatsApp(input.userId, input.incidentId, type, input.notificationId);
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED', providerMessageId: result.messageSid };
        });
      }
      case 'SLACK': return { success: true, outcome: 'SKIPPED', skipped: true };
    }
  } catch (error) {
    if (error instanceof CircuitBreakerError) return { success: false, outcome: 'CIRCUIT_OPEN', error: `Service unavailable (circuit open): ${error.serviceName}` };
    if (error instanceof Error && 'retryable' in error && error.retryable === false) return { success: false, outcome: 'PERMANENT_FAILURE', error: error.message };
    return { success: false, outcome: 'RETRYABLE_FAILURE', error: error instanceof Error ? error.message : String(error) };
  }
}
