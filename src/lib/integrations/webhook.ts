/**
 * Generic Webhook Integration Handler
 * Handles custom webhook integrations with flexible payload mapping
 */

export type WebhookPayload = {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type WebhookConfig = {
  summaryField?: string; // Field path for summary (e.g., "alert.title" or "message")
  severityField?: string; // Field path for severity
  dedupKeyField?: string; // Field path for deduplication key
  sourceField?: string; // Field path for source
  severityMapping?: Record<string, 'critical' | 'error' | 'warning' | 'info'>;
  actionField?: string; // Field to determine trigger/resolve (e.g., "status" or "action")
  triggerValues?: string[]; // Values that indicate trigger (e.g., ["fired", "alert", "critical"])
  resolveValues?: string[]; // Values that indicate resolve (e.g., ["resolved", "ok", "normal"])
};

const DEFAULT_CONFIG: WebhookConfig = {
  summaryField: 'summary',
  severityField: 'severity',
  dedupKeyField: 'dedup_key',
  sourceField: 'source',
  actionField: 'status',
  triggerValues: ['triggered', 'fired', 'alert', 'critical', 'error', 'open'],
  resolveValues: ['resolved', 'ok', 'normal', 'closed', 'fixed'],
  severityMapping: {
    critical: 'critical',
    error: 'error',
    warning: 'warning',
    info: 'info',
    high: 'critical',
    medium: 'warning',
    low: 'info',
  },
};

function getNestedValue(obj: any, path: string): any {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export function transformWebhookToEvent(
  payload: WebhookPayload,
  config: WebhookConfig = {}
): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Extract values using field paths
  const summary =
    getNestedValue(payload, finalConfig.summaryField || 'summary') ||
    payload.title ||
    payload.message ||
    payload.name ||
    'Webhook Alert';

  const severityRaw =
    getNestedValue(payload, finalConfig.severityField || 'severity') ||
    payload.level ||
    payload.priority ||
    'warning';

  // Use configured field, id, alert_id, or create stable key from summary (avoids Date.now() which defeats dedup)
  const dedupKey =
    getNestedValue(payload, finalConfig.dedupKeyField || 'dedup_key') ||
    payload.id ||
    payload.alert_id ||
    `webhook-${(summary || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  const source =
    getNestedValue(payload, finalConfig.sourceField || 'source') ||
    payload.origin ||
    payload.system ||
    'Webhook';

  const actionValue =
    getNestedValue(payload, finalConfig.actionField || 'status') ||
    payload.action ||
    payload.state ||
    'triggered';

  // Determine event action
  const actionValueStr = String(actionValue).toLowerCase();
  let eventAction: 'trigger' | 'resolve' | 'acknowledge' = 'trigger';

  if (finalConfig.resolveValues?.some(v => actionValueStr.includes(v.toLowerCase()))) {
    eventAction = 'resolve';
  } else if (finalConfig.triggerValues?.some(v => actionValueStr.includes(v.toLowerCase()))) {
    eventAction = 'trigger';
  } else if (actionValueStr.includes('acknowledge') || actionValueStr.includes('ack')) {
    eventAction = 'acknowledge';
  }

  // Map severity
  const severityStr = String(severityRaw).toLowerCase();
  const mappedSeverity =
    finalConfig.severityMapping?.[severityStr] ||
    (severityStr.includes('critical') || severityStr.includes('high')
      ? 'critical'
      : severityStr.includes('error')
        ? 'error'
        : severityStr.includes('warning') || severityStr.includes('medium')
          ? 'warning'
          : 'info');

  return {
    event_action: eventAction,
    dedup_key: String(dedupKey),
    payload: {
      summary: String(summary),
      source: String(source),
      severity: mappedSeverity,
      custom_details: payload,
    },
  };
}
