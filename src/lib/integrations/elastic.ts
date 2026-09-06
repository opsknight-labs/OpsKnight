import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type ElasticEvent = {
  rule?: {
    id?: string;
    name?: string;
  };
  alert?: {
    id?: string;
    status?: string;
    severity?: string;
    reason?: string;
  };
  context?: {
    message?: string;
    severity?: string;
  };
  event?: {
    action?: string;
  };
  message?: string;
  status?: string;
  severity?: string;
  [key: string]: unknown;
};

export function transformElasticToEvent(data: ElasticEvent): {
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
    firstString(data.rule?.name, data.alert?.reason, data.context?.message, data.message) ||
    'Elastic Alert';
  const status = firstString(data.alert?.status, data.event?.action, data.status);
  const severity = normalizeSeverity(
    firstString(data.alert?.severity, data.context?.severity, data.severity),
    'warning'
  );
  // Use alert.id or rule.id, fallback to rule name for stable dedup
  const dedupKey =
    firstString(data.alert?.id, data.rule?.id) ||
    `elastic-${(data.rule?.name || summary).replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Elastic',
      severity,
      custom_details: {
        rule: data.rule,
        alert: data.alert,
        context: data.context,
        raw: data,
      },
    },
  };
}
