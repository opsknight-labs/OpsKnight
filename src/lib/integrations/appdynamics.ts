import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type AppDynamicsEvent = {
  eventType?: string;
  eventMessage?: string;
  summary?: string;
  severity?: string;
  eventSeverity?: string;
  application?: string;
  incidentId?: string | number;
  eventId?: string | number;
  eventTime?: string | number;
  [key: string]: unknown;
};

export function transformAppDynamicsToEvent(data: AppDynamicsEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const summary =
    firstString(data.summary, data.eventMessage, data.eventType) || 'AppDynamics Alert';
  const status = firstString(data.eventType);
  const severity = normalizeSeverity(
    firstString(data.severity, data.eventSeverity, data.eventType),
    'warning'
  );
  // Use incident/event ID or create stable key from application/summary (avoids Date.now() and avoids eventType which differs between OPEN and CLOSE)
  const baseName =
    firstString(
      data.application,
      data.summary,
      typeof data.node === 'string' ? data.node : undefined
    ) || 'alert';
  const dedupKey =
    firstString(data.incidentId, data.eventId) ||
    `appdynamics-${baseName.replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'AppDynamics',
      severity,
      custom_details: {
        application: data.application,
        eventType: data.eventType,
        eventTime: data.eventTime,
        raw: data,
      },
    },
  };
}
