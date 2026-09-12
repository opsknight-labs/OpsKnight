import type { IncidentStatus } from '@prisma/client';
import prisma from './prisma';
import {
  CircuitBreakerError,
  CircuitBreakerTimeoutError,
  CircuitBreakers,
} from './circuit-breaker';
import {
  isLegacyTriggeredNotificationIntent,
  notificationIntentEventAt,
  notificationIntentTriggerGeneration,
} from './notification-identity';
import {
  acquireProviderAdmission,
  acquireProviderConcurrency,
  deferProviderAdmission,
  releaseProviderConcurrency,
  type ProviderAdmissionScope,
} from './provider-admission';

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
  | 'QUEUED'
  | 'SKIPPED'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'CIRCUIT_OPEN'
  | 'AMBIGUOUS';

export interface NotificationDeliveryResult {
  success: boolean;
  outcome: NotificationDeliveryOutcome;
  errors?: string[];
  error?: string;
}
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
  pendingTimeoutMs: 2 * 60_000,
});
export interface NotificationAttemptResult {
  success: boolean;
  outcome: NotificationDeliveryOutcome;
  error?: string;
  providerMessageId?: string;
  skipped?: boolean;
}
interface IncidentDeliveryContext {
  id?: string;
  status: IncidentStatus;
  createdAt?: Date;
  updatedAt?: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  currentEscalationStep?: number | null;
  nextEscalationAt?: Date | null;
  escalationStatus?: string | null;
  escalationGeneration?: number;
  service?: { webhookUrl: string | null } | null;
}
export interface NotificationAttemptInput {
  notificationId: string;
  incidentId: string;
  userId: string;
  channel: NotificationDeliveryChannel;
  eventType: NotificationEventType;
  message?: string | null;
  incident?: IncidentDeliveryContext | null;
}
export function notificationRetryDelayMs(
  attempts: number,
  policy: NotificationRetryPolicy = NOTIFICATION_RETRY_POLICY,
  random: () => number = Math.random
): number {
  const baseDelay = Math.min(
    policy.initialDelayMs * 2 ** Math.max(0, attempts),
    policy.maximumDelayMs
  );
  const jittered = Math.round(baseDelay * (0.8 + Math.min(Math.max(random(), 0), 1) * 0.4));
  return Math.min(jittered, policy.maximumDelayMs);
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

function staleIntentReason(
  input: NotificationAttemptInput,
  incident: IncidentDeliveryContext | null
): string | null {
  if (!incident) return null;
  const expectedAt = notificationIntentEventAt(input.notificationId)?.getTime() ?? null;
  if (input.eventType === 'triggered') {
    if (incident.status !== 'OPEN') {
      return `Triggered notification superseded by incident state ${incident.status}`;
    }
    if (isLegacyTriggeredNotificationIntent(input.notificationId)) {
      return 'Triggered notification predates immutable escalation generation';
    }
    const expectedGeneration = notificationIntentTriggerGeneration(input.notificationId);
    if (
      expectedGeneration != null &&
      (incident.escalationGeneration ?? 0) !== expectedGeneration
    ) {
      return 'Triggered notification belongs to a superseded escalation generation';
    }
    return null;
  }
  if (input.eventType === 'acknowledged') {
    if (incident.status === 'RESOLVED')
      return 'Acknowledged notification superseded by incident resolution';
    if (expectedAt && incident.acknowledgedAt?.getTime() !== expectedAt)
      return 'Acknowledged notification belongs to a superseded lifecycle generation';
    return null;
  }
  if (input.eventType === 'resolved') {
    if (incident.status !== 'RESOLVED')
      return `Resolved notification superseded by incident state ${incident.status}`;
    if (expectedAt && incident.resolvedAt?.getTime() !== expectedAt)
      return 'Resolved notification belongs to a superseded lifecycle generation';
    return null;
  }
  if (expectedAt && incident.updatedAt?.getTime() !== expectedAt)
    return 'Incident update notification superseded by a newer incident revision';
  return null;
}

async function resolveProviderKey(
  channel: NotificationDeliveryChannel,
  incident: IncidentDeliveryContext
): Promise<string> {
  if (channel === 'WEBHOOK') {
    const url = incident.service?.webhookUrl;
    if (!url) return 'service-webhook';
    try {
      return new URL(url).origin;
    } catch {
      return 'service-webhook';
    }
  }
  if (channel === 'SLACK') return 'default';
  // EMAIL / SMS / PUSH / WHATSAPP — resolve the actual configured provider so
  // capacity (EMAIL:ses vs EMAIL:default) matches the central control plane.
  try {
    if (channel === 'EMAIL') {
      const { getAllConfiguredEmailProviders } = await import('./notification-providers');
      const configs = await getAllConfiguredEmailProviders();
      const provider = configs.find(c => c.enabled && c.provider)?.provider;
      return provider || 'default';
    }
    if (channel === 'SMS') {
      const { getSMSConfig } = await import('./notification-providers');
      const cfg = await getSMSConfig();
      return cfg.provider || 'default';
    }
    if (channel === 'WHATSAPP') {
      const { getWhatsAppConfig } = await import('./notification-providers');
      const cfg = await getWhatsAppConfig();
      return cfg.provider || 'default';
    }
    if (channel === 'PUSH') {
      const { getPushConfig } = await import('./notification-providers');
      const cfg = await getPushConfig();
      return cfg.provider || 'default';
    }
  } catch {
    // Provider resolution must not block delivery; fall back to default bucket.
  }
  return 'default';
}

type ProviderAdmissionLease = { leaseKey: string; providerKey: string; scope: ProviderAdmissionScope };

async function providerAdmission(
  input: NotificationAttemptInput,
  incident: IncidentDeliveryContext
): Promise<NotificationAttemptResult | ProviderAdmissionLease | null> {
  if (input.channel === 'SLACK') return null;
  const scope = input.channel as ProviderAdmissionScope;
  const providerKey = await resolveProviderKey(input.channel, incident);
  const admission = await acquireProviderAdmission(scope, providerKey);
  if (!admission.allowed) {
    return {
      success: true,
      outcome: 'QUEUED',
      error: `Provider admission deferred until ${admission.retryAt.toISOString()}`,
    };
  }
  const concurrency = await acquireProviderConcurrency(scope, providerKey);
  if (!concurrency.allowed) {
    return {
      success: true,
      outcome: 'QUEUED',
      error: `Provider concurrency deferred until ${concurrency.retryAt.toISOString()}`,
    };
  }
  return { leaseKey: concurrency.leaseKey, providerKey, scope };
}

function shouldDefer(result: unknown): { retryAfterMs?: number } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r.statusCode === 429) return { retryAfterMs: typeof r.retryAfterMs === 'number' ? r.retryAfterMs : 60_000 };
  // Some providers surface 429 via error string
  const msg = typeof r.error === 'string' ? r.error : '';
  if (/too many requests|rate.?limit|429/i.test(msg)) return { retryAfterMs: 60_000 };
  return null;
}

async function handleProviderResultFailure(
  lease: ProviderAdmissionLease,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
): Promise<void> {
  const defer = shouldDefer(raw);
  if (!defer) return;
  const retryAt = new Date(Date.now() + Math.max(defer.retryAfterMs ?? 60_000, 1_000));
  try {
    await deferProviderAdmission(lease.scope, lease.providerKey, retryAt);
  } catch {
    // Backpressure must not fail delivery accounting; admission already defers via RateLimit.
  }
}

export async function dispatchNotificationAttempt(
  input: NotificationAttemptInput
): Promise<NotificationAttemptResult> {
  // Always read the current lifecycle generation immediately before provider
  // contact. The caller's incident is an immutable rendering snapshot, not a
  // safe stale-delivery fence: state may have changed after fan-out began.
  const incident = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      currentEscalationStep: true,
      nextEscalationAt: true,
      escalationStatus: true,
      escalationGeneration: true,
      service: { select: { webhookUrl: true } },
    },
  });
  const type = input.eventType;
  if (!incident)
    return { success: false, outcome: 'PERMANENT_FAILURE', error: 'Incident not found' };
  const staleReason = staleIntentReason(input, incident);
  if (staleReason) return { success: true, outcome: 'SKIPPED', skipped: true, error: staleReason };
  const admission = await providerAdmission(input, incident);
  if (admission && 'outcome' in admission) return admission;
  const lease = admission as ProviderAdmissionLease | null;

  let outcome: NotificationAttemptResult | null = null;
  let releasedLease = false;
  async function releaseLeaseOnce(): Promise<void> {
    if (lease && !releasedLease) {
      releasedLease = true;
      await releaseProviderConcurrency(lease.leaseKey).catch(() => undefined);
    }
  }
  try {
    switch (input.channel) {
      case 'EMAIL': {
        const { sendIncidentEmail } = await import('./email');
        outcome = await CircuitBreakers.email().execute(async () => {
          const result = await sendIncidentEmail(
            input.userId,
            input.incidentId,
            type,
            input.notificationId,
            input.message ?? undefined
          );
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED' as const };
        });
        break;
      }
      case 'SMS': {
        const { sendIncidentSMS } = await import('./sms');
        outcome = await CircuitBreakers.sms().execute(async () => {
          const result = await sendIncidentSMS(
            input.userId,
            input.incidentId,
            type,
            input.notificationId,
            input.message ?? undefined
          );
          if (!result.success) return providerFailureResult(result);
          return {
            ...result,
            success: true,
            outcome: 'DELIVERED' as const,
            providerMessageId: result.messageSid,
          };
        });
        break;
      }
      case 'PUSH': {
        const { sendNotificationIntentPush } = await import('./incident-push-delivery');
        outcome = await CircuitBreakers.push().execute(async () => {
          const result = await sendNotificationIntentPush(
            input.userId,
            input.incidentId,
            type,
            input.message,
            input.notificationId
          );
          if (result.success) return { ...result, success: true, outcome: 'DELIVERED' as const };
          if (result.code === 'NO_DEVICE_TOKENS' || result.code === 'NO_WEB_SUBSCRIPTIONS')
            return { ...result, outcome: 'SKIPPED' as const, skipped: true };
          return providerFailureResult(result);
        });
        break;
      }
      case 'WEBHOOK': {
        const webhookUrl = incident.service?.webhookUrl;
        if (!webhookUrl) {
          outcome = {
            success: false,
            outcome: 'PERMANENT_FAILURE',
            error: 'No webhook URL configured for service',
          };
          break;
        }
        const { sendIncidentWebhook } = await import('./webhooks');
        outcome = await CircuitBreakers.webhook(webhookUrl).execute(async () => {
          const result = await sendIncidentWebhook(webhookUrl, input.incidentId, type);
          if (!result.success) return providerFailureResult(result);
          return { ...result, success: true, outcome: 'DELIVERED' as const };
        });
        break;
      }
      case 'WHATSAPP': {
        const { sendIncidentWhatsApp } = await import('./whatsapp');
        outcome = await CircuitBreakers.whatsapp().execute(async () => {
          const result = await sendIncidentWhatsApp(
            input.userId,
            input.incidentId,
            type,
            input.notificationId,
            input.message ?? undefined
          );
          if (!result.success) return providerFailureResult(result);
          return {
            ...result,
            success: true,
            outcome: 'DELIVERED' as const,
            providerMessageId: result.messageSid,
          };
        });
        break;
      }
      case 'SLACK':
        outcome = { success: true, outcome: 'SKIPPED', skipped: true };
        break;
    }
    if (outcome && !outcome.success && lease) {
      await handleProviderResultFailure(lease, outcome as unknown as Record<string, unknown>);
    }
    return outcome ?? { success: true, outcome: 'SKIPPED', skipped: true };
  } catch (error) {
    if (error instanceof CircuitBreakerTimeoutError) {
      // AMBIGUOUS: provider may still be processing — keep distributed slot until lease expires.
      outcome = {
        success: false,
        outcome: 'AMBIGUOUS',
        error: `Provider outcome is ambiguous after timeout: ${error.serviceName}`,
      };
      return outcome;
    }
    if (error instanceof CircuitBreakerError) {
      outcome = {
        success: false,
        outcome: 'CIRCUIT_OPEN',
        error: `Service unavailable (circuit open): ${error.serviceName}`,
      };
      return outcome;
    }
    if (error instanceof Error && 'retryable' in error && error.retryable === false) {
      outcome = { success: false, outcome: 'PERMANENT_FAILURE', error: error.message };
      return outcome;
    }
    outcome = {
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      error: error instanceof Error ? error.message : String(error),
    };
    return outcome;
  } finally {
    // AMBIGUOUS keeps the distributed lease; every other path releases exactly once.
    // `outcome` is set for every error path above so the timeout branch survives the `finally`.
    if (lease && outcome?.outcome !== 'AMBIGUOUS') {
      await releaseLeaseOnce();
    }
  }
}
