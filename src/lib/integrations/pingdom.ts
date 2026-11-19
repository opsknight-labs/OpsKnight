import { normalizeEventAction, firstString } from './normalization';

export type PingdomEvent = {
  check_id?: string | number;
  check_name?: string;
  state?: string;
  current_state?: string;
  previous_state?: string;
  importance_level?: string;
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
  // Pingdom webhooks send current_state (UP/DOWN, or SUCCESS/FAILING for
  // transaction checks); `state` is kept for older custom senders.
  const status = firstString(data.current_state, data.state)?.toUpperCase();
  const isRecovery = status === 'UP' || status === 'SUCCESS';
  const isDown = status === 'DOWN' || status === 'FAILING';
  const severity = isDown ? (data.importance_level === 'LOW' ? 'warning' : 'critical') : 'info';
  // Use check_id or create stable key from check_name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(data.check_id) ||
    `pingdom-${(data.check_name || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: isRecovery ? 'resolve' : normalizeEventAction(status, 'trigger'),
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
