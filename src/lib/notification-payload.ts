import type { NotificationEventType } from './notification-delivery';

const PREFIX = 'OPSKNIGHT_NOTIFICATION_V1:';

export type IncidentNotificationSnapshot = {
  incidentId: string;
  title: string;
  description: string | null;
  status: string;
  urgency: string;
  priority: string | null;
  service: { id: string; name: string };
  assignee: { id?: string; name?: string | null; email?: string | null } | null;
  team: { id?: string; name?: string | null } | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  eventAt: string;
  eventType: NotificationEventType;
  escalationLevel: number | null;
};

export type IncidentNotificationEnvelope = {
  version: 1;
  displayMessage: string;
  snapshot: IncidentNotificationSnapshot;
};

function asDate(value: unknown): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

export function buildNotificationEnvelope(
  incident: {
    id: string;
    title?: string | null;
    description?: string | null;
    status?: string | null;
    urgency?: string | null;
    priority?: string | null;
    createdAt: Date;
    updatedAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
    currentEscalationStep?: number | null;
    serviceId?: string | null;
    service?: { id?: string; name?: string | null } | null;
    assignee?: { id?: string; name?: string | null; email?: string | null } | null;
    team?: { id?: string; name?: string | null } | null;
  },
  eventType: NotificationEventType,
  eventAt: Date,
  displayMessage: string
): IncidentNotificationEnvelope {
  const eventStatus =
    eventType === 'resolved'
      ? 'RESOLVED'
      : eventType === 'acknowledged'
        ? 'ACKNOWLEDGED'
        : eventType === 'triggered'
          ? 'OPEN'
          : incident.status || 'OPEN';
  const escalationMatch = /Escalation Level\s+(\d+)/i.exec(displayMessage);
  const escalationLevel = escalationMatch ? Number(escalationMatch[1]) : null;

  return {
    version: 1,
    displayMessage,
    snapshot: {
      incidentId: incident.id,
      title: incident.title || 'Incident',
      description: incident.description ?? null,
      status: eventStatus,
      urgency: incident.urgency || 'LOW',
      priority: incident.priority ?? null,
      service: {
        id: incident.service?.id || incident.serviceId || '',
        name: incident.service?.name || 'Service',
      },
      assignee: incident.assignee
        ? {
            id: incident.assignee.id,
            name: incident.assignee.name ?? null,
            email: incident.assignee.email ?? null,
          }
        : null,
      team: incident.team
        ? { id: incident.team.id, name: incident.team.name ?? null }
        : null,
      createdAt: incident.createdAt.toISOString(),
      acknowledgedAt:
        eventType === 'triggered' ? null : asDate(incident.acknowledgedAt)?.toISOString() ?? null,
      resolvedAt:
        eventType === 'resolved' ? asDate(incident.resolvedAt)?.toISOString() ?? eventAt.toISOString() : null,
      eventAt: eventAt.toISOString(),
      eventType,
      escalationLevel: Number.isInteger(escalationLevel) && escalationLevel! > 0 ? escalationLevel : null,
    },
  };
}

export function encodeNotificationEnvelope(envelope: IncidentNotificationEnvelope): string {
  return PREFIX + JSON.stringify(envelope);
}

export function decodeNotificationEnvelope(value: string | null | undefined): IncidentNotificationEnvelope | null {
  if (!value?.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(PREFIX.length)) as Partial<IncidentNotificationEnvelope>;
    if (parsed.version !== 1 || typeof parsed.displayMessage !== 'string' || !parsed.snapshot) return null;
    return parsed as IncidentNotificationEnvelope;
  } catch {
    return null;
  }
}

export function notificationDisplayMessage(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decodeNotificationEnvelope(value)?.displayMessage ?? value;
}
