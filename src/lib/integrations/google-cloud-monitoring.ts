import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type GoogleCloudMonitoringEvent = {
  incident?: {
    incident_id?: string;
    state?: string;
    summary?: string;
    policy_name?: string;
    severity?: string;
    resource?: {
      type?: string;
      display_name?: string;
      labels?: Record<string, string>;
    };
    condition?: {
      name?: string;
    };
    started_at?: string;
    ended_at?: string;
  };
  summary?: string;
  state?: string;
  severity?: string;
  policy_name?: string;
  resource?: {
    type?: string;
    display_name?: string;
  };
  [key: string]: unknown;
};

export function transformGoogleCloudMonitoringToEvent(data: GoogleCloudMonitoringEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const incident = data.incident;
  const state = firstString(incident?.state, data.state);
  const summary =
    firstString(incident?.summary, data.summary, incident?.condition?.name, data.policy_name) ||
    'GCP Monitoring Alert';
  const severity = normalizeSeverity(firstString(incident?.severity, data.severity), 'warning');
  const policy = firstString(incident?.policy_name, data.policy_name);
  const resourceName = firstString(
    incident?.resource?.display_name,
    data.resource?.display_name,
    incident?.resource?.type,
    data.resource?.type
  );
  const incidentId = firstString(incident?.incident_id);
  // Use incidentId or policy+resource for stable dedup key (avoids Date.now() which defeats dedup)
  const dedupKey =
    incidentId ||
    (policy && resourceName
      ? `gcp-${policy}-${resourceName}`
      : policy
        ? `gcp-${policy}`
        : `gcp-${(summary || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`);

  return {
    event_action: normalizeEventAction(state, 'trigger'),
    dedup_key: dedupKey,
    payload: {
      summary,
      source: 'Google Cloud Monitoring',
      severity,
      custom_details: {
        incident,
        policy,
        resource: incident?.resource || data.resource,
        raw: data,
      },
    },
  };
}
