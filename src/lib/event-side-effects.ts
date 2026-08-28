import prisma from './prisma';
import { executeEscalation } from './notifications';
import { notifySlackForIncident } from './slack';
import { logger } from './logger';
import type { EventSideEffectPayload, LifecycleSideEffectContext } from './event-outbox';

export function escalationNotificationRoute(result: {
  escalated?: boolean;
  reason?: string;
}): 'service' | 'fallback' {
  const reason = (result.reason || '').toLowerCase();
  const policyOwnsResponderRouting =
    result.escalated === true ||
    reason.includes('scheduled') ||
    reason.includes('already in progress');

  return policyOwnsResponderRouting ? 'service' : 'fallback';
}

async function sendEventWebhook(
  payload: EventSideEffectPayload,
  eventType: 'incident.created' | 'incident.resolved'
): Promise<void> {
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    include: {
      service: { select: { id: true, name: true } },
      assignee: {
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
      },
    },
  });

  if (!incident) {
    logger.info('event.outbox.incident_missing', { incidentId: payload.incidentId, eventType });
    return;
  }

  const { triggerWebhooksForService } = await import('./status-page-webhooks');
  const webhookPayload = {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    status: eventType === 'incident.created' ? 'OPEN' : 'RESOLVED',
    urgency: incident.urgency,
    priority: incident.priority,
    service: {
      id: incident.service.id,
      name: incident.service.name,
    },
    assignee: incident.assignee,
    createdAt: incident.createdAt.toISOString(),
    ...(eventType === 'incident.resolved'
      ? {
          acknowledgedAt: incident.acknowledgedAt?.toISOString() || null,
          resolvedAt: incident.resolvedAt?.toISOString() || payload.eventOrderAt,
        }
      : {}),
  };

  await triggerWebhooksForService(incident.serviceId, eventType, webhookPayload);
}

async function runTriggerEscalationAndNotifications(incidentId: string): Promise<void> {
  const startedAt = performance.now();
  let escalationResult: Awaited<ReturnType<typeof executeEscalation>>;

  try {
    escalationResult = await executeEscalation(incidentId);
  } catch (error) {
    logger.error('event.outbox.escalation_failed', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    const { sendServiceNotifications } = await import('./service-notifications');
    await sendServiceNotifications(incidentId, 'triggered');
    return;
  }

  const route = escalationNotificationRoute(escalationResult || {});

  if (route === 'service') {
    const { sendServiceNotifications } = await import('./service-notifications');
    await sendServiceNotifications(incidentId, 'triggered');
  } else {
    const { sendIncidentNotifications } = await import('./user-notifications');
    await sendIncidentNotifications(incidentId, 'triggered');
  }

  logger.info('event.outbox.notifications_sent', {
    incidentId,
    route,
    latencyMs: performance.now() - startedAt,
  });
}

function lifecycleContext(payload: EventSideEffectPayload): LifecycleSideEffectContext {
  if (!payload.lifecycle) {
    throw new Error(`Lifecycle context missing for ${payload.effect}`);
  }
  return payload.lifecycle;
}

function lifecycleNotificationEvent(
  lifecycle: LifecycleSideEffectContext
): 'acknowledged' | 'resolved' | 'updated' {
  if (lifecycle.status === 'ACKNOWLEDGED') return 'acknowledged';
  if (lifecycle.status === 'RESOLVED') return 'resolved';
  return 'updated';
}

function lifecycleStatusPageEvent(
  lifecycle: LifecycleSideEffectContext
): 'acknowledged' | 'resolved' | 'investigating' | 'snoozed' | 'suppressed' {
  switch (lifecycle.status) {
    case 'ACKNOWLEDGED':
      return 'acknowledged';
    case 'RESOLVED':
      return 'resolved';
    case 'OPEN':
      return 'investigating';
    case 'SNOOZED':
      return 'snoozed';
    case 'SUPPRESSED':
      return 'suppressed';
  }
}

function lifecycleWebhookEvent(lifecycle: LifecycleSideEffectContext): string {
  switch (lifecycle.status) {
    case 'ACKNOWLEDGED':
      return 'incident.acknowledged';
    case 'RESOLVED':
      return 'incident.resolved';
    case 'SNOOZED':
      return 'incident.snoozed';
    case 'SUPPRESSED':
      return 'incident.suppressed';
    case 'OPEN':
      return 'incident.updated';
  }
}

async function sendLifecycleWebhook(payload: EventSideEffectPayload): Promise<void> {
  const lifecycle = lifecycleContext(payload);
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    include: {
      service: { select: { id: true, name: true } },
      assignee: {
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
      },
    },
  });

  if (!incident) {
    logger.info('lifecycle.outbox.incident_missing', {
      incidentId: payload.incidentId,
      effect: payload.effect,
    });
    return;
  }

  if (
    (lifecycle.source === 'WEB' || lifecycle.source === 'MOBILE') &&
    incident.visibility !== 'PUBLIC'
  ) {
    return;
  }

  const { triggerWebhooksForService } = await import('./status-page-webhooks');
  const resolvedAt =
    lifecycle.status === 'RESOLVED'
      ? incident.resolvedAt?.toISOString() || lifecycle.transitionAt
      : incident.resolvedAt?.toISOString() || null;

  await triggerWebhooksForService(incident.serviceId, lifecycleWebhookEvent(lifecycle), {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    status: lifecycle.status,
    urgency: incident.urgency,
    priority: incident.priority,
    service: incident.service,
    assignee: incident.assignee,
    createdAt: incident.createdAt.toISOString(),
    acknowledgedAt: incident.acknowledgedAt?.toISOString() || null,
    resolvedAt,
  });
}

async function syncLifecycleWarRoom(payload: EventSideEffectPayload): Promise<void> {
  const lifecycle = lifecycleContext(payload);
  if (lifecycle.status === 'RESOLVED') {
    throw new Error('Resolved lifecycle transitions must use the archive effect');
  }

  const { postWarRoomUpdate, updateWarRoomTopic } = await import('./chatops/war-room');
  const statusEmoji = {
    ACKNOWLEDGED: '👀',
    OPEN: '🔄',
    SNOOZED: '😴',
    SUPPRESSED: '🔇',
  } as const;

  await Promise.all([
    postWarRoomUpdate(
      payload.incidentId,
      `${statusEmoji[lifecycle.status]} *Status updated to ${lifecycle.status}*`
    ),
    updateWarRoomTopic(payload.incidentId, lifecycle.status),
  ]);
}

export async function processEventSideEffect(payload: EventSideEffectPayload): Promise<void> {
  if (
    payload.task !== 'EVENT_SIDE_EFFECT' ||
    !payload.effect ||
    !payload.lane ||
    !payload.incidentId ||
    !payload.eventOrderAt
  ) {
    throw new Error('Invalid EVENT_SIDE_EFFECT payload');
  }

  switch (payload.effect) {
    case 'TRIGGER_WEBHOOK':
      await sendEventWebhook(payload, 'incident.created');
      return;

    case 'TRIGGER_ESCALATION_NOTIFICATIONS':
      await runTriggerEscalationAndNotifications(payload.incidentId);
      return;

    case 'TRIGGER_WAR_ROOM': {
      const { createIncidentWarRoom } = await import('./chatops/war-room');
      const result = await createIncidentWarRoom(payload.incidentId);
      if (result.success) {
        logger.info('event.outbox.war_room_created', {
          incidentId: payload.incidentId,
          channelName: result.channelName,
        });
      }
      return;
    }

    case 'RESOLVE_WEBHOOK':
      await sendEventWebhook(payload, 'incident.resolved');
      return;

    case 'RESOLVE_SLACK':
      await notifySlackForIncident(payload.incidentId, 'resolved');
      return;

    case 'RESOLVE_WAR_ROOM_ARCHIVE': {
      const { archiveWarRoomChannel } = await import('./chatops/war-room');
      await archiveWarRoomChannel(payload.incidentId);
      return;
    }

    case 'ACK_SLACK':
      await notifySlackForIncident(payload.incidentId, 'acknowledged');
      return;

    case 'LIFECYCLE_USER_NOTIFICATION': {
      const { sendIncidentNotifications } = await import('./user-notifications');
      await sendIncidentNotifications(
        payload.incidentId,
        lifecycleNotificationEvent(lifecycleContext(payload))
      );
      return;
    }

    case 'LIFECYCLE_SERVICE_NOTIFICATION': {
      const { sendServiceNotifications } = await import('./service-notifications');
      await sendServiceNotifications(
        payload.incidentId,
        lifecycleNotificationEvent(lifecycleContext(payload))
      );
      return;
    }

    case 'LIFECYCLE_STATUS_PAGE': {
      const { notifyStatusPageSubscribers } = await import('./status-page-notifications');
      const notify = notifyStatusPageSubscribers as (
        incidentId: string,
        eventType: string
      ) => Promise<void>;
      await notify(payload.incidentId, lifecycleStatusPageEvent(lifecycleContext(payload)));
      return;
    }

    case 'LIFECYCLE_WEBHOOK':
      await sendLifecycleWebhook(payload);
      return;

    case 'LIFECYCLE_WAR_ROOM_SYNC':
      await syncLifecycleWarRoom(payload);
      return;

    case 'LIFECYCLE_WAR_ROOM_TOPIC': {
      const lifecycle = lifecycleContext(payload);
      const { updateWarRoomTopic } = await import('./chatops/war-room');
      await updateWarRoomTopic(payload.incidentId, lifecycle.status);
      return;
    }

    case 'LIFECYCLE_WAR_ROOM_ARCHIVE': {
      const { archiveWarRoomChannel } = await import('./chatops/war-room');
      await archiveWarRoomChannel(payload.incidentId);
      return;
    }
  }

  throw new Error(
    `Unknown EVENT_SIDE_EFFECT effect: ${String((payload as { effect?: unknown }).effect)}`
  );
}
