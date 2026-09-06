import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type BetterUptimeEvent = {
  incident?: {
    id?: string | number;
    name?: string;
    status?: string;
    severity?: string;
    cause?: string;
    started_at?: string;
    resolved_at?: string;
    url?: string;
  };
  name?: string;
  status?: string;
  severity?: string;
  [key: string]: unknown;
};

export function transformBetterUptimeToEvent(data: BetterUptimeEvent): {
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
  const summary = firstString(incident?.name, data.name, incident?.cause) || 'Better Uptime Alert';
  const status = firstString(incident?.status, data.status);
  const severity = normalizeSeverity(firstString(incident?.severity, data.severity), 'warning');
  // Use incident.id or create stable key from name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(incident?.id) ||
    `better-uptime-${(incident?.name || data.name || 'alert').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Better Uptime',
      severity,
      custom_details: {
        incident,
        raw: data,
      },
    },
  };
}
