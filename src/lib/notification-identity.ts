import { createHash } from 'node:crypto';
import type { NotificationDeliveryChannel, NotificationEventType } from './notification-delivery';

const notificationEventTypes = new Set<NotificationEventType>([
  'triggered',
  'acknowledged',
  'resolved',
  'updated',
]);

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
  const parsed = parseNotificationIntentId(notificationId);
  if (!parsed) return null;
  const millis = Number(parsed.timestamp);
  if (!Number.isSafeInteger(millis)) return null;
  const value = new Date(millis);
  return Number.isFinite(value.getTime()) ? value : null;
}

/** Returns the durable trigger generation carried by newer legacy intent IDs. */
export function notificationIntentTriggerGeneration(notificationId: string): number | null {
  const parsed = parseNotificationIntentId(notificationId);
  if (!parsed || parsed.eventType !== 'triggered' || parsed.generation === undefined) return null;
  const generation = Number(parsed.generation);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

/**
 * IDs written before durable escalation generations were introduced. They are
 * intentionally distinguishable from malformed IDs so the upgrade fence can
 * stop a replayed legacy row from duplicating a new generation-zero intent.
 */
export function isLegacyTriggeredNotificationIntent(notificationId: string): boolean {
  const parsed = parseNotificationIntentId(notificationId);
  return parsed?.eventType === 'triggered' && parsed.generation === undefined;
}

function isDecimal(value: string): boolean {
  return value.length > 0 && [...value].every(char => char >= '0' && char <= '9');
}

function isSha256Hex(value: string): boolean {
  return (
    value.length === 64 &&
    [...value].every(
      char =>
        (char >= '0' && char <= '9') ||
        (char >= 'a' && char <= 'f') ||
        (char >= 'A' && char <= 'F')
    )
  );
}

function parseNotificationIntentId(
  value: string
): { eventType: NotificationEventType; timestamp: string; generation?: string } | null {
  const parts = value.split(':');
  const [prefix, eventType, timestamp, fourth, fifth] = parts;
  if (
    parts.length < 4 ||
    parts.length > 5 ||
    prefix !== 'ntf' ||
    !eventType ||
    !timestamp ||
    !fourth ||
    !notificationEventTypes.has(eventType as NotificationEventType) ||
    !isDecimal(timestamp)
  ) {
    return null;
  }
  if (parts.length === 4 && isSha256Hex(fourth)) {
    return { eventType: eventType as NotificationEventType, timestamp };
  }
  if (
    parts.length === 5 &&
    eventType === 'triggered' &&
    fourth.startsWith('g') &&
    isDecimal(fourth.slice(1)) &&
    fifth &&
    isSha256Hex(fifth)
  ) {
    return { eventType: 'triggered', timestamp, generation: fourth.slice(1) };
  }
  return null;
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
