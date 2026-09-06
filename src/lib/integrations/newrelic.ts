import { createHash } from 'crypto';
import { normalizeEventAction, normalizeSeverity } from './normalization';

export type NewRelicEvent = {
  account_id?: number;
  account_name?: string;
  event_type?: string;
  incident?: {
    id: string;
    title: string;
    state?: string;
    severity?: string;
    created_at?: string;
    updated_at?: string;
    condition_name?: string;
    condition_id?: number;
    policy_name?: string;
    policy_id?: number;
  };
  // Legacy format
  alert?: {
    id: string;
    alert_policy_name: string;
    alert_condition_name: string;
    severity: string;
    timestamp: number;
    state: string;
    message?: string;
  };
  // APM format
  alertType?: string;
  alertSeverity?: string;
  alertTitle?: string;
  alertMessage?: string;
  alertTimestamp?: number;
};

export function transformNewRelicToEvent(payload: NewRelicEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  // Handle new incident format
  if (payload.incident) {
    const incident = payload.incident;
    const eventAction = normalizeEventAction(incident.state || payload.event_type, 'trigger');
    const severity = normalizeSeverity(incident.severity, 'warning');

    return {
      event_action: eventAction,
      dedup_key: `newrelic-${incident.id}`,
      payload: {
        summary: incident.title,
        source: `New Relic${payload.account_name ? ` - ${payload.account_name}` : ''}`,
        severity,
        custom_details: {
          account_id: payload.account_id,
          account_name: payload.account_name,
          event_type: payload.event_type,
          incident: {
            id: incident.id,
            state: incident.state,
            severity: incident.severity,
            created_at: incident.created_at,
            updated_at: incident.updated_at,
            condition_name: incident.condition_name,
            condition_id: incident.condition_id,
            policy_name: incident.policy_name,
            policy_id: incident.policy_id,
          },
        },
      },
    };
  }

  // Handle legacy alert format
  if (payload.alert) {
    const alert = payload.alert;
    const isResolved = alert.state === 'closed';

    const severityMap: Record<string, 'critical' | 'error' | 'warning' | 'info'> = {
      critical: 'critical',
      warning: 'warning',
      info: 'info',
    };
    const severity = severityMap[alert.severity?.toLowerCase() || 'warning'] || 'warning';

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: `newrelic-${alert.id}`,
      payload: {
        summary: alert.alert_condition_name || alert.message || 'New Relic Alert',
        source: `New Relic - ${alert.alert_policy_name}`,
        severity,
        custom_details: {
          alert_id: alert.id,
          alert_policy_name: alert.alert_policy_name,
          alert_condition_name: alert.alert_condition_name,
          severity: alert.severity,
          timestamp: alert.timestamp,
          state: alert.state,
          message: alert.message,
        },
      },
    };
  }

  // Handle APM format
  if (payload.alertTitle || payload.alertType) {
    const isResolved =
      payload.alertType?.toLowerCase().includes('resolved') ||
      payload.alertType?.toLowerCase().includes('closed');

    const severityMap: Record<string, 'critical' | 'error' | 'warning' | 'info'> = {
      critical: 'critical',
      error: 'error',
      warning: 'warning',
      info: 'info',
    };
    const severity = severityMap[payload.alertSeverity?.toLowerCase() || 'warning'] || 'warning';

    // Use alertTitle for stable dedup key (avoids Date.now() which defeats dedup)
    const rawKey = payload.alertTitle
      ? `newrelic-apm-${payload.alertTitle}`
      : `newrelic-apm-${payload.alertType || 'unknown'}`;

    const dedupKey = createHash('sha256').update(rawKey).digest('hex').slice(0, 32);

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: payload.alertTitle || 'New Relic Alert',
        source: 'New Relic',
        severity,
        custom_details: {
          alertType: payload.alertType,
          alertSeverity: payload.alertSeverity,
          alertTitle: payload.alertTitle,
          alertMessage: payload.alertMessage,
          alertTimestamp: payload.alertTimestamp,
          account_id: payload.account_id,
          account_name: payload.account_name,
        },
      },
    };
  }
  // Fallback for unsupported payload formats - return acknowledge instead of throwing
  // Use account info for stable dedup key (avoids Date.now() which defeats dedup)
  return {
    event_action: 'acknowledge' as const,
    dedup_key: `newrelic-unknown-${payload.account_id || payload.account_name || 'fallback'}`,
    payload: {
      summary: 'New Relic event received: unknown format',
      source: `New Relic${payload.account_name ? ` - ${payload.account_name}` : ''}`,
      severity: 'info' as const,
      custom_details: payload,
    },
  };
}
