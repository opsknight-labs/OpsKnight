import prisma from './prisma';
import { executeEscalation } from './notifications';
import { notifySlackForIncident } from './slack';
import { logger } from './logger';
import type { EventSideEffectPayload } from './event-outbox';

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

  // Incident deletion makes the side-effect obsolete rather than retryable.
  if (!incident) {
    logger.info('event.outbox.incident_missing', { incidentId: payload.incidentId, eventType });
    return;
  }

  const { triggerWebhooksForService } = await import('./status-page-webhooks');
  const webhookPayload = {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    // The job can run after a later incident transition has committed. Preserve
    // the lifecycle state represented by this durable event rather than leaking
    // a newer current status into an older webhook.
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
    // Preserve the previous fallback only for an escalation execution failure.
    // Notification-provider failures below must escape to the durable queue so
    // they are retried instead of immediately entering a second send path.
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
  }

  throw new Error(
    `Unknown EVENT_SIDE_EFFECT effect: ${String((payload as { effect?: unknown }).effect)}`
  );
}
