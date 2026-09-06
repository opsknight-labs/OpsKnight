import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type PingdomEvent = {
  check_id?: string | number;
  check_name?: string;
  state?: string;
  message?: string;
  description?: string;
  last_error?: string;
  time?: string | number;
  [key: string]: unknown;
};

export function transformPingdomToEvent(data: PingdomEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const summary = firstString(data.check_name, data.message, data.description) || 'Pingdom Alert';
  const status = firstString(data.state);
  const severity = normalizeSeverity(
    status && status.toLowerCase().includes('down') ? 'critical' : 'info',
    'warning'
  );
  // Use check_id or create stable key from check_name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(data.check_id) ||
    `pingdom-${(data.check_name || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Pingdom',
      severity,
      custom_details: {
        lastError: data.last_error,
        time: data.time,
        raw: data,
      },
    },
  };
}
