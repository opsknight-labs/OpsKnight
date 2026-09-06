import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type HoneycombEvent = {
  alert_id?: string;
  alert_name?: string;
  alert_severity?: string;
  event_type?: string;
  status?: string;
  trigger_reason?: string;
  result_url?: string;
  dataset?: string;
  [key: string]: unknown;
};

export function transformHoneycombToEvent(data: HoneycombEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const safeData = data && typeof data === 'object' ? data : {};
  const summary = firstString(safeData.alert_name, safeData.trigger_reason) || 'Honeycomb Alert';
  const status = firstString(safeData.status, safeData.event_type);
  const severity = normalizeSeverity(safeData.alert_severity, 'warning');
  // Use alert_id or create stable key from alert_name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(safeData.alert_id) ||
    `honeycomb-${(safeData.alert_name || 'alert').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Honeycomb',
      severity,
      custom_details: {
        dataset: data.dataset,
        resultUrl: data.result_url,
        raw: data,
      },
    },
  };
}
