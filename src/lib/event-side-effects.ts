import prisma from './prisma';
import { executeEscalation } from './notifications';
import { logger } from './logger';
import type { EventSideEffectPayload, LifecycleSideEffectContext } from './event-outbox';
import {
  isRetryableNotificationOutcome,
  type NotificationDeliveryOutcome,
} from './notification-delivery';

function requireDelivery(
  result:
    | {
        success?: boolean;
        outcome?: NotificationDeliveryOutcome;
        error?: string;
        errors?: string[];
      }
    | undefined,
  label: string
): void {
  if (result?.outcome && !isRetryableNotificationOutcome(result.outcome)) return;
  if (result?.outcome && isRetryableNotificationOutcome(result.outcome))
    throw new Error(
      `${label} failed: ${result.error || result.errors?.join('; ') || 'retryable delivery failure'}`
    );
  if (result?.success === false)
    throw new Error(
      `${label} failed: ${result.error || result.errors?.join('; ') || 'unknown error'}`
    );
}
function requireWebhookDelivery(result: { failed: number } | undefined, label: string): void {
  if (result && result.failed > 0)
    throw new Error(`${label} failed for ${result.failed} delivery target(s)`);
}
const EXPECTED_WAR_ROOM_SKIPS = [
  'Incident not found',
  'ChatOps is not enabled',
  'auto-creation disabled',
  'does not meet urgency/priority threshold',
  'No war-room channel',
  'No active war-room channel',
  'War-room channel is archived',
  'Archive on resolve is disabled',
  'No Slack bot token',
  'not configured',
];
function requireWarRoomDelivery(result: { success: boolean; error?: string }, label: string): void {
  if (result.success || EXPECTED_WAR_ROOM_SKIPS.some(reason => result.error?.includes(reason)))
    return;
  throw new Error(`${label} failed: ${result.error || 'unknown error'}`);
}

export function escalationNotificationRoute(result: {
  escalated?: boolean;
  reason?: string;
}): 'service' | 'fallback' {
  const reason = (result.reason || '').toLowerCase();
  const policyOwnsResponderRouting =
    result.escalated === true ||
    reason.includes('scheduled') ||
    reason.includes('already in progress') ||
    reason.includes('already completed') ||
    reason.includes('completed') ||
    reason.includes('exhausted') ||
    reason.includes('superseded');
  return policyOwnsResponderRouting ? 'service' : 'fallback';
}

async function sideEffectSnapshotStillCurrent(payload: EventSideEffectPayload): Promise<boolean> {
  if (payload.escalationGeneration == null && !payload.incidentStatus) return true;
  const current = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    select: { escalationGeneration: true, status: true },
  });
  if (!current) return false;
  if (
    payload.escalationGeneration != null &&
    current.escalationGeneration !== payload.escalationGeneration
  )
    return false;
  if (payload.incidentStatus && current.status !== payload.incidentStatus) return false;
  return true;
}

async function sendEventWebhook(
  payload: EventSideEffectPayload,
  eventType: 'incident.created' | 'incident.resolved'
): Promise<void> {
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    include: {
      service: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, gender: true } },
    },
  });
  if (!incident) return;
  const { triggerWebhooksForService } = await import('./status-page-webhooks');
  requireWebhookDelivery(
    await triggerWebhooksForService(
      incident.serviceId,
      eventType,
      {
        id: incident.id,
        title: incident.title,
        description: incident.description,
        status: eventType === 'incident.created' ? 'OPEN' : 'RESOLVED',
        urgency: incident.urgency,
        priority: incident.priority,
        service: incident.service,
        assignee: incident.assignee,
        createdAt: incident.createdAt.toISOString(),
        ...(eventType === 'incident.resolved'
          ? {
              acknowledgedAt: incident.acknowledgedAt?.toISOString() || null,
              resolvedAt: incident.resolvedAt?.toISOString() || payload.eventOrderAt,
            }
          : {}),
      },
      payload.eventOrderAt,
      {
        expectedStatus: payload.incidentStatus,
        escalationGeneration: payload.escalationGeneration,
      }
    ),
    eventType
  );
}

async function runTriggerEscalationAndNotifications(incidentId: string): Promise<void> {
  const startedAt = performance.now();
  const escalationResult = await executeEscalation(incidentId);
  const route = escalationNotificationRoute(escalationResult || {});
  if (route === 'fallback') {
    const { sendIncidentNotifications } = await import('./user-notifications');
    requireDelivery(await sendIncidentNotifications(incidentId, 'triggered'), 'user notification');
  }
  logger.info('event.outbox.notifications_planned', {
    incidentId,
    route,
    latencyMs: performance.now() - startedAt,
  });
}
async function sendTriggerServiceNotification(payload: EventSideEffectPayload): Promise<void> {
  if (!(await sideEffectSnapshotStillCurrent(payload))) return;
  const { sendServiceNotifications } = await import('./service-notifications');
  requireDelivery(
    await sendServiceNotifications(payload.incidentId, 'triggered', {
      escalationGeneration: payload.escalationGeneration,
      expectedStatus: payload.incidentStatus,
    }),
    'trigger service notification'
  );
}
async function notifyCreatedIncidentStatusPage(payload: EventSideEffectPayload): Promise<void> {
  if (!(await sideEffectSnapshotStillCurrent(payload))) return;
  const { notifyStatusPageSubscribers } = await import('./status-page-notifications');
  requireDelivery(
    await notifyStatusPageSubscribers(payload.incidentId, 'triggered', payload.eventOrderAt),
    'status page notification'
  );
}

async function createJiraIssueForIncident(incidentId: string): Promise<void> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: { include: { jiraServiceMapping: true } },
      externalIssueLinks: { where: { provider: 'JIRA' }, select: { id: true } },
    },
  });
  const mapping = incident?.service?.jiraServiceMapping;
  if (
    !incident ||
    !mapping?.autoCreateIncidentIssue ||
    (mapping.autoCreateIncidentUrgencies.length > 0 &&
      !mapping.autoCreateIncidentUrgencies.includes(incident.urgency)) ||
    incident.externalIssueLinks.length > 0
  )
    return;
  const jiraConfig = await prisma.jiraConfig.findUnique({
    where: { id: 'default' },
    select: { enabled: true },
  });
  if (!jiraConfig?.enabled) return;
  const { createJiraIssueAndLink } = await import('./jira-sync');
  const { issue } = await createJiraIssueAndLink({
    incidentId,
    projectKey: mapping.projectKey,
    issueType: mapping.incidentIssueType || 'Bug',
    summary: `[Incident] ${incident.title}`,
    description: incident.description || `OpsKnight Incident: ${incident.title}`,
    labels: mapping.defaultLabels.length > 0 ? mapping.defaultLabels : ['opsknight'],
    component: mapping.defaultComponent,
  });
  await prisma.incidentEvent.create({
    data: { incidentId, type: 'LEGACY_OTHER', message: `Jira issue ${issue.key} auto-created` },
  });
}
function lifecycleContext(payload: EventSideEffectPayload): LifecycleSideEffectContext {
  if (!payload.lifecycle) throw new Error(`Lifecycle context missing for ${payload.effect}`);
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
  if (!(await sideEffectSnapshotStillCurrent(payload))) return;
  const lifecycle = lifecycleContext(payload);
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    include: {
      service: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, gender: true } },
    },
  });
  if (!incident || incident.visibility !== 'PUBLIC') return;
  const { triggerWebhooksForService } = await import('./status-page-webhooks');
  const resolvedAt =
    lifecycle.status === 'RESOLVED'
      ? incident.resolvedAt?.toISOString() || lifecycle.transitionAt
      : incident.resolvedAt?.toISOString() || null;
  requireWebhookDelivery(
    await triggerWebhooksForService(
      incident.serviceId,
      lifecycleWebhookEvent(lifecycle),
      {
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
      },
      payload.eventOrderAt,
      {
        expectedStatus: lifecycle.status,
        escalationGeneration: payload.escalationGeneration,
      }
    ),
    'lifecycle webhook'
  );
}
async function sendIncidentUpdateWebhook(payload: EventSideEffectPayload): Promise<void> {
  if (!(await sideEffectSnapshotStillCurrent(payload))) return;
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    include: {
      service: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, gender: true } },
    },
  });
  if (!incident) return;
  const { triggerWebhooksForService } = await import('./status-page-webhooks');
  requireWebhookDelivery(
    await triggerWebhooksForService(
      incident.serviceId,
      'incident.updated',
      {
        id: incident.id,
        title: incident.title,
        description: incident.description,
        status: incident.status,
        urgency: incident.urgency,
        priority: incident.priority,
        visibility: incident.visibility,
        service: incident.service,
        assignee: incident.assignee,
        createdAt: incident.createdAt.toISOString(),
        acknowledgedAt: incident.acknowledgedAt?.toISOString() || null,
        resolvedAt: incident.resolvedAt?.toISOString() || null,
      },
      payload.eventOrderAt,
      {
        expectedStatus: payload.incidentStatus,
        escalationGeneration: payload.escalationGeneration,
      }
    ),
    'incident update webhook'
  );
}
async function syncLifecycleWarRoom(payload: EventSideEffectPayload): Promise<void> {
  const lifecycle = lifecycleContext(payload);
  if (lifecycle.status === 'RESOLVED')
    throw new Error('Resolved lifecycle transitions must use the archive effect');
  const { postWarRoomUpdate, updateWarRoomTopic } = await import('./chatops/war-room');
  const emoji =
    lifecycle.status === 'ACKNOWLEDGED'
      ? '👀'
      : lifecycle.status === 'OPEN'
        ? '🔄'
        : lifecycle.status === 'SNOOZED'
          ? '😴'
          : '🔇';
  const [postResult, topicResult] = await Promise.all([
    postWarRoomUpdate(payload.incidentId, `${emoji} *Status updated to ${lifecycle.status}*`),
    updateWarRoomTopic(payload.incidentId, lifecycle.status),
  ]);
  requireWarRoomDelivery(postResult, 'war-room status update');
  requireWarRoomDelivery(topicResult, 'war-room topic update');
}
async function ensureLifecycleWarRoom(payload: EventSideEffectPayload): Promise<void> {
  const lifecycle = lifecycleContext(payload);
  if (lifecycle.command !== 'REOPEN' || lifecycle.status !== 'OPEN')
    throw new Error('War-room ensure is only valid for an OPEN reopen transition');
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    select: { status: true },
  });
  if (!incident || incident.status !== 'OPEN') return;
  const { createIncidentWarRoom } = await import('./chatops/war-room');
  const result = await createIncidentWarRoom(payload.incidentId);
  if (!result.success) {
    requireWarRoomDelivery(result, 'war-room ensure');
    return;
  }
  await syncLifecycleWarRoom(payload);
}
async function archiveWarRoomIfStillResolved(payload: EventSideEffectPayload): Promise<void> {
  const lifecycle = payload.lifecycle;
  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    select: { status: true, resolvedAt: true },
  });
  if (!incident || incident.status !== 'RESOLVED') return;
  if (
    lifecycle?.status === 'RESOLVED' &&
    incident.resolvedAt?.toISOString() !== lifecycle.transitionAt
  )
    return;
  const { archiveWarRoomChannel } = await import('./chatops/war-room');
  requireWarRoomDelivery(await archiveWarRoomChannel(payload.incidentId), 'war-room archive');
}

export async function processEventSideEffect(payload: EventSideEffectPayload): Promise<void> {
  if (
    payload.task !== 'EVENT_SIDE_EFFECT' ||
    !payload.effect ||
    !payload.lane ||
    !payload.incidentId ||
    !payload.eventOrderAt
  )
    throw new Error('Invalid EVENT_SIDE_EFFECT payload');
  switch (payload.effect) {
    case 'TRIGGER_WEBHOOK':
      await sendEventWebhook(payload, 'incident.created');
      return;
    case 'TRIGGER_ESCALATION_NOTIFICATIONS':
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      await runTriggerEscalationAndNotifications(payload.incidentId);
      return;
    case 'TRIGGER_SERVICE_NOTIFICATION':
      await sendTriggerServiceNotification(payload);
      return;
    case 'TRIGGER_WAR_ROOM': {
      const { createIncidentWarRoom } = await import('./chatops/war-room');
      requireWarRoomDelivery(await createIncidentWarRoom(payload.incidentId), 'war-room creation');
      return;
    }
    case 'TRIGGER_STATUS_PAGE':
      await notifyCreatedIncidentStatusPage(payload);
      return;
    case 'TRIGGER_JIRA':
      await createJiraIssueForIncident(payload.incidentId);
      return;
    case 'RESOLVE_WEBHOOK':
      await sendEventWebhook(payload, 'incident.resolved');
      return;
    case 'RESOLVE_SLACK':
      requireDelivery(
        await import('./service-notifications').then(module =>
          module.sendServiceNotifications(payload.incidentId, 'resolved')
        ),
        'service resolve notification'
      );
      return;
    case 'RESOLVE_WAR_ROOM_ARCHIVE':
      await archiveWarRoomIfStillResolved(payload);
      return;
    case 'ACK_SLACK':
      requireDelivery(
        await import('./service-notifications').then(module =>
          module.sendServiceNotifications(payload.incidentId, 'acknowledged')
        ),
        'service acknowledge notification'
      );
      return;
    case 'LIFECYCLE_USER_NOTIFICATION': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { sendIncidentNotifications } = await import('./user-notifications');
      const lifecycle = lifecycleContext(payload);
      requireDelivery(
        await sendIncidentNotifications(
          payload.incidentId,
          lifecycleNotificationEvent(lifecycle),
          [],
          undefined,
          { eventAt: new Date(lifecycle.transitionAt), status: lifecycle.status }
        ),
        'lifecycle user notification'
      );
      return;
    }
    case 'LIFECYCLE_SERVICE_NOTIFICATION': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { sendServiceNotifications } = await import('./service-notifications');
      const lifecycle = lifecycleContext(payload);
      requireDelivery(
        await sendServiceNotifications(payload.incidentId, lifecycleNotificationEvent(lifecycle), {
          eventAt: new Date(lifecycle.transitionAt),
          escalationGeneration: payload.escalationGeneration,
          expectedStatus: lifecycle.status,
        }),
        'lifecycle service notification'
      );
      return;
    }
    case 'LIFECYCLE_STATUS_PAGE': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { notifyStatusPageSubscribers } = await import('./status-page-notifications');
      requireDelivery(
        await notifyStatusPageSubscribers(
          payload.incidentId,
          lifecycleStatusPageEvent(lifecycleContext(payload)),
          payload.eventOrderAt
        ),
        'lifecycle status page notification'
      );
      return;
    }
    case 'INCIDENT_UPDATE_USER_NOTIFICATION': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { sendIncidentNotifications } = await import('./user-notifications');
      requireDelivery(
        await sendIncidentNotifications(payload.incidentId, 'updated', [], undefined, {
          eventAt: new Date(payload.eventOrderAt),
          status: payload.incidentStatus,
        }),
        'incident update user notification'
      );
      return;
    }
    case 'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { sendIncidentNotifications } = await import('./user-notifications');
      requireDelivery(
        await sendIncidentNotifications(payload.incidentId, 'updated', [], undefined, {
          intent: 'ASSIGNED_TO_USER',
          eventAt: new Date(payload.eventOrderAt),
          status: payload.incidentStatus,
        }),
        'incident assignment notification'
      );
      return;
    }
    case 'INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { sendIncidentNotifications } = await import('./user-notifications');
      requireDelivery(
        await sendIncidentNotifications(payload.incidentId, 'updated', [], undefined, {
          intent: 'ASSIGNED_TO_TEAM',
          eventAt: new Date(payload.eventOrderAt),
          status: payload.incidentStatus,
        }),
        'team assignment notification'
      );
      return;
    }
    case 'INCIDENT_UPDATE_SERVICE_NOTIFICATION': {
      if (!(await sideEffectSnapshotStillCurrent(payload))) return;
      const { sendServiceNotifications } = await import('./service-notifications');
      requireDelivery(
        await sendServiceNotifications(payload.incidentId, 'updated', {
          eventAt: new Date(payload.eventOrderAt),
          escalationGeneration: payload.escalationGeneration,
          expectedStatus: payload.incidentStatus,
        }),
        'incident update service notification'
      );
      return;
    }
    case 'INCIDENT_UPDATE_WEBHOOK':
      await sendIncidentUpdateWebhook(payload);
      return;
    case 'LIFECYCLE_WEBHOOK':
      await sendLifecycleWebhook(payload);
      return;
    case 'LIFECYCLE_WAR_ROOM_SYNC':
      await syncLifecycleWarRoom(payload);
      return;
    case 'LIFECYCLE_WAR_ROOM_ENSURE':
      await ensureLifecycleWarRoom(payload);
      return;
    case 'LIFECYCLE_WAR_ROOM_TOPIC': {
      const { updateWarRoomTopic } = await import('./chatops/war-room');
      requireWarRoomDelivery(
        await updateWarRoomTopic(payload.incidentId, lifecycleContext(payload).status),
        'war-room topic update'
      );
      return;
    }
    case 'LIFECYCLE_WAR_ROOM_ARCHIVE':
      await archiveWarRoomIfStillResolved(payload);
      return;
  }
  throw new Error(
    `Unknown EVENT_SIDE_EFFECT effect: ${String((payload as { effect?: unknown }).effect)}`
  );
}
