import type { Incident, Service } from '@prisma/client';
import prisma from './prisma';
import { incidentNotificationPriority } from './notification-priority';
import {
  NOTIFICATION_CHANNELS,
  type NotificationDeliveryOutcome,
  type NotificationEventType,
} from './notification-delivery';
import {
  notificationEventInstant,
  notificationEventKey,
  type NotificationIdentityIncident,
} from './notification-identity';
import { buildNotificationEnvelope, encodeNotificationEnvelope } from './notification-payload';

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
type IncidentWithService = Incident & {
  service?: Service | null;
  assignee?: { id?: string; name?: string | null; email?: string | null } | null;
  team?: { id?: string; name?: string | null } | null;
};

async function sendCentralIncidentNotification(input: {
  incidentId: string;
  userId: string;
  channel: NotificationChannel;
  eventType: NotificationEventType;
  eventKey: string;
  durableMessage: string;
  eventAt: Date;
  escalationGeneration?: number;
  escalationStep?: number | null;
  priority?: string | null;
  urgency?: string | null;
  /** Record the page as SKIPPED with this reason instead of delivering it. */
  suppressedReason?: string;
}): Promise<SendNotificationResult | null> {
  // SLACK here is the personal Slack DM page; service channel posts use their own outbox effect.
  if (!['EMAIL', 'SMS', 'VOICE', 'PUSH', 'WHATSAPP', 'SLACK'].includes(input.channel)) return null;
  // Voice is an actionable responder page, not a lifecycle broadcast channel.
  if (input.channel === 'VOICE' && input.eventType !== 'triggered') {
    return {
      success: true,
      outcome: 'SKIPPED',
      skipped: true,
      terminal: true,
      error: 'Voice calls are only sent for triggered incident pages',
    };
  }
  const recipient = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, phoneNumber: true },
  });
  const recipientAddress =
    input.channel === 'EMAIL' || input.channel === 'SLACK'
      ? recipient?.email
      : input.channel === 'SMS' || input.channel === 'VOICE' || input.channel === 'WHATSAPP'
        ? recipient?.phoneNumber
        : input.userId;
  if (!recipientAddress) {
    return {
      success: true,
      outcome: 'SKIPPED',
      skipped: true,
      terminal: true,
      error: `Recipient has no ${input.channel.toLowerCase()} address`,
    };
  }
  const { enqueueCentralNotification } = await import('./notification-control-plane');
  const kind = `INCIDENT_${input.channel}` as
    | 'INCIDENT_EMAIL'
    | 'INCIDENT_SMS'
    | 'INCIDENT_VOICE'
    | 'INCIDENT_PUSH'
    | 'INCIDENT_WHATSAPP'
    | 'INCIDENT_SLACK';
  const queued = await enqueueCentralNotification({
    category: 'INCIDENT',
    channel: input.channel,
    recipientType: 'USER',
    recipientId: input.userId,
    recipientAddress,
    userId: input.userId,
    incidentId: input.incidentId,
    templateKey: `incident-${input.eventType}`,
    sourceType: 'INCIDENT',
    sourceId: input.incidentId,
    eventKey: input.eventKey,
    displayMessage: 'Incident notification',
    suppressedReason: input.suppressedReason,
    ...incidentNotificationPriority(input),
    payload: {
      kind,
      userId: input.userId,
      incidentId: input.incidentId,
      eventType: input.eventType,
      eventAt: input.eventAt.toISOString(),
      escalationGeneration: input.escalationGeneration,
      escalationStep: input.escalationStep ?? undefined,
      durableMessage: input.durableMessage,
    },
  });
  const persisted = await prisma.notification.findUnique({
    where: { id: queued.id },
    select: { id: true, status: true, attempts: true, maxAttempts: true, errorMsg: true },
  });
  if (!persisted) {
    if (queued.delivered) {
      return { success: true, outcome: 'DELIVERED', notificationId: queued.id };
    }
    return {
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      notificationId: queued.id,
      error: queued.error || 'Central notification intent could not be reloaded',
    };
  }
  return existingIntentResult(persisted);
}
export type SendNotificationResult = {
  success: boolean;
  outcome: NotificationDeliveryOutcome;
  notificationId?: string;
  error?: string;
  terminal?: boolean;
  skipped?: boolean;
  queued?: boolean;
  deduped?: boolean;
};
async function loadIdentityIncident(
  incidentId: string,
  incident?: IncidentWithService
): Promise<(NotificationIdentityIncident & IncidentWithService) | null> {
  if (incident) return incident as NotificationIdentityIncident & IncidentWithService;
  return prisma.incident.findUnique({
    where: { id: incidentId },
    include: { service: true, assignee: true, team: true },
  }) as Promise<(NotificationIdentityIncident & IncidentWithService) | null>;
}
function existingIntentResult(notification: {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  errorMsg?: string | null;
}): SendNotificationResult {
  if (notification.status === 'SENT' || notification.status === 'DELIVERED')
    return { success: true, outcome: 'DELIVERED', notificationId: notification.id, deduped: true };
  if (notification.status === 'SKIPPED')
    return {
      success: true,
      outcome: 'SKIPPED',
      notificationId: notification.id,
      skipped: true,
      terminal: true,
      deduped: true,
    };
  if (notification.status === 'FAILED' && notification.attempts >= notification.maxAttempts)
    return {
      success: false,
      outcome: 'PERMANENT_FAILURE',
      notificationId: notification.id,
      error: notification.errorMsg || 'Notification retry budget exhausted',
      terminal: true,
      deduped: true,
    };
  return {
    success: true,
    outcome: 'QUEUED',
    notificationId: notification.id,
    queued: true,
    deduped: true,
  };
}

export async function sendNotification(
  incidentId: string,
  userId: string,
  channel: NotificationChannel,
  message: string,
  incident?: IncidentWithService,
  eventType: NotificationEventType = 'triggered',
  explicitEventKey?: string,
  /** Record the page as SKIPPED with this reason instead of delivering it. */
  suppressedReason?: string
): Promise<SendNotificationResult> {
  if (!NOTIFICATION_CHANNELS.includes(channel))
    return {
      success: false,
      outcome: 'PERMANENT_FAILURE',
      error: `Unknown channel: ${String(channel)}`,
      terminal: true,
    };
  const identityIncident = await loadIdentityIncident(incidentId, incident);
  if (!identityIncident)
    return {
      success: false,
      outcome: 'PERMANENT_FAILURE',
      error: 'Incident not found',
      terminal: true,
    };
  const eventAt = notificationEventInstant(identityIncident, eventType);
  // A suppressed record gets its own key so it can never block a real page for the same event.
  const eventKey = `${
    explicitEventKey ?? notificationEventKey({ incident: identityIncident, eventType, message })
  }${suppressedReason ? ':suppressed' : ''}`;
  const durableMessage = encodeNotificationEnvelope(
    buildNotificationEnvelope(identityIncident, eventType, eventAt, message)
  );
  const central = await sendCentralIncidentNotification({
    incidentId,
    userId,
    channel,
    eventType,
    eventKey,
    durableMessage,
    eventAt,
    escalationGeneration: identityIncident.escalationGeneration,
    escalationStep: identityIncident.currentEscalationStep,
    priority: identityIncident.priority,
    urgency: identityIncident.urgency,
    suppressedReason,
  });
  return (
    central ?? {
      success: false,
      outcome: 'PERMANENT_FAILURE',
      terminal: true,
      error: `Channel ${channel} is not supported by the central personal notification plane`,
    }
  );
}
export { executeEscalation } from './escalation';
