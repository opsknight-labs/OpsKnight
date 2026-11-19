import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

type BetterUptimeIncident = {
  id?: string | number;
  name?: string;
  status?: string;
  severity?: string;
  cause?: string;
  started_at?: string | null;
  resolved_at?: string | null;
  url?: string;
  acknowledged_at?: string | null;
};

export type BetterUptimeEvent = {
  // A custom template may send just the incident id string.
  incident?: BetterUptimeIncident | string | number;
  // Better Stack's default webhook is a JSON:API envelope.
  data?: { id?: string | number; attributes?: BetterUptimeIncident; [key: string]: unknown };
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
  const incident: BetterUptimeIncident | undefined =
    data.incident && typeof data.incident === 'object'
      ? data.incident
      : data.data?.attributes
        ? { id: data.data.id, ...data.data.attributes }
        : data.incident !== undefined
          ? { id: data.incident }
          : undefined;
  const summary = firstString(incident?.name, data.name, incident?.cause) || 'Better Uptime Alert';
  const status =
    firstString(incident?.status, data.status) ||
    (incident?.resolved_at ? 'resolved' : incident?.acknowledged_at ? 'acknowledged' : undefined);
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
