import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type SplunkOnCallEvent = {
  message_type?: string;
  entity_id?: string;
  entity_display_name?: string;
  state_message?: string;
  incident_id?: string | number;
  state?: string;
  status?: string;
  message?: string;
  severity?: string;
  alert?: {
    id?: string;
    message?: string;
    severity?: string;
  };
  [key: string]: unknown;
};

export function transformSplunkOnCallToEvent(data: SplunkOnCallEvent): {
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
    firstString(data.message, data.state_message, data.entity_display_name, data.alert?.message) ||
    'Splunk On-Call Alert';
  const status = firstString(data.status, data.state, data.message_type);
  const severity = normalizeSeverity(
    firstString(data.severity, data.message_type, data.alert?.severity),
    'warning'
  );
  // Use incident/entity/alert ID or create stable key from entity name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(data.incident_id, data.entity_id, data.alert?.id) ||
    `splunk-oncall-${(data.entity_display_name || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Splunk On-Call',
      severity,
      custom_details: {
        entityId: data.entity_id,
        messageType: data.message_type,
        stateMessage: data.state_message,
        alert: data.alert,
        raw: data,
      },
    },
  };
}
