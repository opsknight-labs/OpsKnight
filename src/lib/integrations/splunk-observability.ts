import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type SplunkObservabilityEvent = {
  incidentId?: string | number;
  detectorId?: string | number;
  detectorName?: string;
  severity?: string;
  title?: string;
  description?: string;
  eventType?: string;
  status?: string;
  link?: string;
  [key: string]: unknown;
};

export function transformSplunkObservabilityToEvent(data: SplunkObservabilityEvent): {
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
    firstString(data.title, data.detectorName, data.description) || 'Splunk Observability Alert';
  const status = firstString(data.status, data.eventType);
  const severity = normalizeSeverity(data.severity, 'warning');
  // Use incidentId/detectorId or create stable key from detector name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(data.incidentId, data.detectorId) ||
    `splunk-observability-${(data.detectorName || data.title || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Splunk Observability',
      severity,
      custom_details: {
        detectorId: data.detectorId,
        detectorName: data.detectorName,
        link: data.link,
        raw: data,
      },
    },
  };
}
