import { createHash } from 'node:crypto';
import type { NotificationDeliveryChannel, NotificationEventType } from './notification-delivery';

export type NotificationIdentityIncident = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  currentEscalationStep?: number | null;
  nextEscalationAt?: Date | null;
  escalationStatus?: string | null;
  escalationGeneration?: number;
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function notificationEventInstant(
  incident: NotificationIdentityIncident,
  eventType: NotificationEventType
): Date {
  if (eventType === 'resolved') {
    return incident.resolvedAt ?? incident.updatedAt;
  }
  if (eventType === 'acknowledged') {
    return incident.acknowledgedAt ?? incident.updatedAt;
  }
  if (eventType === 'updated') {
    return incident.updatedAt;
  }

  // A triggered event is born when the incident is created. Escalation
  // scheduling fields are deliberately excluded: they change while the same
  // event's Email, Push, SMS, and WhatsApp intents are being fanned out.
  return incident.createdAt;
}

export function notificationEventKey(input: {
  incident: NotificationIdentityIncident;
  eventType: NotificationEventType;
  purpose?: string;
  message?: string | null;
}): string {
  const eventAt = notificationEventInstant(input.incident, input.eventType);
  const purpose = input.purpose?.trim() || 'INCIDENT';
  const messageDigest = hash(input.message ?? '').slice(0, 16);
  const escalationStep =
    input.eventType === 'triggered' && input.incident.currentEscalationStep != null
      ? `:step-${input.incident.currentEscalationStep}`
      : '';
  const escalationGeneration =
    input.eventType === 'triggered'
      ? `:generation-${input.incident.escalationGeneration ?? 0}`
      : '';
  return `${input.incident.id}:${input.eventType}:${eventAt.toISOString()}:${purpose}${escalationGeneration}${escalationStep}:${messageDigest}`;
}

export function notificationIntentId(input: {
  eventKey: string;
  eventType: NotificationEventType;
  eventAt: Date;
  userId: string;
  channel: NotificationDeliveryChannel;
  triggerGeneration?: number;
}): string {
  const digest = hash([input.eventKey, input.userId, input.channel].join('\u001f'));
  const generation =
    input.eventType === 'triggered' && input.triggerGeneration != null
      ? `:g${input.triggerGeneration}`
      : '';
  return `ntf:${input.eventType}:${input.eventAt.getTime()}${generation}:${digest}`;
}

export function notificationIntentEventAt(notificationId: string): Date | null {
  const match = /^ntf:(?:triggered|acknowledged|resolved|updated):(\d+)(?::g\d+)?:[a-f0-9]{64}$/.exec(
    notificationId
  );
  if (!match) return null;
  const millis = Number(match[1]);
  if (!Number.isSafeInteger(millis)) return null;
  const value = new Date(millis);
  return Number.isFinite(value.getTime()) ? value : null;
}

/** Returns the durable trigger generation carried by newer legacy intent IDs. */
export function notificationIntentTriggerGeneration(notificationId: string): number | null {
  const match = /^ntf:triggered:\d+:g(\d+):[a-f0-9]{64}$/.exec(notificationId);
  if (!match) return null;
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

export function inAppNotificationIntentId(input: {
  eventKey: string;
  userId: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
}): string {
  return `inapp:${hash(
    [input.eventKey, input.userId, input.type, input.entityType ?? '', input.entityId ?? ''].join(
      '\u001f'
    )
  )}`;
}
