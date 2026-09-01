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

  const escalationOwned =
    incident.escalationStatus === 'ESCALATING' || incident.currentEscalationStep != null;
  if (escalationOwned) {
    return incident.nextEscalationAt ?? incident.updatedAt;
  }
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
  return `${input.incident.id}:${input.eventType}:${eventAt.toISOString()}:${purpose}${escalationStep}:${messageDigest}`;
}

export function notificationIntentId(input: {
  eventKey: string;
  eventType: NotificationEventType;
  eventAt: Date;
  userId: string;
  channel: NotificationDeliveryChannel;
}): string {
  const digest = hash([input.eventKey, input.userId, input.channel].join('\u001f'));
  return `ntf:${input.eventType}:${input.eventAt.getTime()}:${digest}`;
}

export function notificationIntentEventAt(notificationId: string): Date | null {
  const match = /^ntf:(?:triggered|acknowledged|resolved|updated):(\d+):[a-f0-9]{64}$/.exec(
    notificationId
  );
  if (!match) return null;
  const millis = Number(match[1]);
  if (!Number.isSafeInteger(millis)) return null;
  const value = new Date(millis);
  return Number.isFinite(value.getTime()) ? value : null;
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
