import type { Incident, Service } from '@prisma/client';
import prisma from './prisma';
import {
  dispatchNotificationAttempt,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RETRY_POLICY,
  type NotificationDeliveryOutcome,
  type NotificationEventType,
} from './notification-delivery';
import {
  notificationEventInstant,
  notificationEventKey,
  notificationIntentId,
  type NotificationIdentityIncident,
} from './notification-identity';
import { buildNotificationEnvelope, encodeNotificationEnvelope } from './notification-payload';

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
type IncidentWithService = Incident & {
  service?: Service | null;
  assignee?: { id?: string; name?: string | null; email?: string | null } | null;
  team?: { id?: string; name?: string | null } | null;
};
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
function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
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
  if (
    notification.status === 'FAILED' &&
    notification.attempts >= NOTIFICATION_RETRY_POLICY.maxAttempts
  )
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
  explicitEventKey?: string
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
  const eventKey =
    explicitEventKey ?? notificationEventKey({ incident: identityIncident, eventType, message });
  const notificationId = notificationIntentId({ eventKey, eventType, eventAt, userId, channel });
  const durableMessage = encodeNotificationEnvelope(
    buildNotificationEnvelope(identityIncident, eventType, eventAt, message)
  );
  let notification: { id: string; attempts: number; status: string; errorMsg?: string | null };
  try {
    notification = await prisma.notification.create({
      data: {
        id: notificationId,
        incidentId,
        userId,
        channel,
        message: durableMessage,
        eventType,
        status: 'PENDING',
        attempts: 0,
      },
      select: { id: true, attempts: true, status: true, errorMsg: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error))
      return {
        success: false,
        outcome: 'RETRYABLE_FAILURE',
        error: error instanceof Error ? error.message : String(error),
      };
    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, status: true, attempts: true, errorMsg: true },
    });
    if (!existing)
      return {
        success: false,
        outcome: 'RETRYABLE_FAILURE',
        error: 'Notification intent conflicted but could not be reloaded',
      };
    return existingIntentResult(existing);
  }
  try {
    const result = await dispatchNotificationAttempt({
      notificationId: notification.id,
      incidentId,
      userId,
      channel,
      eventType,
      message: durableMessage,
      incident,
    });
    if (result.outcome === 'DELIVERED') {
      const committed = await prisma.notification.updateMany({
        where: { id: notification.id, status: 'PENDING' },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId },
      });
      const recipient = prisma.user?.findUnique
        ? await prisma.user
            .findUnique({ where: { id: userId }, select: { name: true, email: true } })
            .catch(() => null)
        : null;
      const recipientName = recipient?.name || recipient?.email || userId;
      try {
        if (committed.count > 0 && prisma.incidentEvent?.create)
          await prisma.incidentEvent.create({
            data: {
              incidentId,
              type: 'STATUS_CHANGE',
              message: `Notification sent to ${recipientName} via ${channel}`,
            },
          });
      } catch (_) {}
      return { success: true, outcome: 'DELIVERED', notificationId: notification.id };
    }
    if (result.outcome === 'SKIPPED') {
      await prisma.notification.updateMany({
        where: { id: notification.id, status: 'PENDING' },
        data: {
          status: 'SKIPPED',
          errorMsg: result.error || 'Delivery skipped by notification policy.',
        },
      });
      return {
        success: true,
        outcome: 'SKIPPED',
        skipped: true,
        terminal: true,
        error: result.error,
        notificationId: notification.id,
      };
    }
    if (result.outcome === 'QUEUED') {
      await prisma.notification.updateMany({
        where: { id: notification.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMsg: result.error || 'Provider admission deferred',
          attempts: notification.attempts,
        },
      });
      return {
        success: true,
        outcome: 'QUEUED',
        queued: true,
        error: result.error,
        notificationId: notification.id,
      };
    }
    const circuitOpen = result.outcome === 'CIRCUIT_OPEN';
    const permanentFailure = result.outcome === 'PERMANENT_FAILURE';
    await prisma.notification.updateMany({
      where: { id: notification.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: result.error || 'Notification delivery failed',
        attempts: circuitOpen
          ? notification.attempts
          : permanentFailure
            ? NOTIFICATION_RETRY_POLICY.maxAttempts
            : (notification.attempts || 0) + 1,
      },
    });
    return {
      success: false,
      outcome: result.outcome,
      terminal: permanentFailure,
      error: result.error || 'Notification delivery failed',
      notificationId: notification.id,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.notification.updateMany({
      where: { id: notification.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: errorMessage,
        attempts: (notification.attempts || 0) + 1,
      },
    });
    return {
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      error: errorMessage,
      notificationId: notification.id,
    };
  }
}
export { executeEscalation } from './escalation';
