/**
 * Prometheus Alertmanager Integration Handler
 * Transforms Prometheus Alertmanager webhooks to standard event format
 */

import crypto from 'crypto';
import { normalizeSeverity } from './normalization';

export type PrometheusAlert = {
  version: string;
  groupKey: string;
  status: 'firing' | 'resolved';
  receiver: string;
  groupLabels: Record<string, string>;
  commonLabels: Record<string, string>;
  commonAnnotations: Record<string, string>;
  externalURL: string;
  alerts: Array<{
    status: 'firing' | 'resolved';
    labels: Record<string, string>;
    annotations: Record<string, string>;
    startsAt: string;
    endsAt?: string;
    generatorURL: string;
    fingerprint: string;
  }>;
};

export function transformPrometheusToEvent(payload: PrometheusAlert): Array<{
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}> {
  if (!payload.alerts || payload.alerts.length === 0) {
    // Return acknowledge for empty alerts array instead of throwing
    // Use groupKey or receiver for stable dedup key
    return [
      {
        event_action: 'acknowledge',
        dedup_key: `prometheus-empty-${payload.groupKey || payload.receiver || 'unknown'}`,
        payload: {
          summary: 'Prometheus alert received: empty alerts array',
          source: 'Prometheus Alertmanager',
          severity: 'info',
          custom_details: payload,
        },
      },
    ];
  }

  return payload.alerts.map(alert => {
    const isResolved =
      payload.status === 'resolved' ||
      alert.status === 'resolved' ||
      (Boolean(alert.endsAt) &&
        alert.endsAt !== '0001-01-01T00:00:00Z' &&
        alert.status !== 'firing' &&
        new Date(alert.endsAt!).getTime() <= Date.now());

    const summary =
      alert.annotations?.summary ||
      alert.annotations?.description ||
      alert.labels?.alertname ||
      'Prometheus Alert';

    // Use fingerprint as dedup key if available
    // Fallback: Create a stable hash from sorted labels to ensure identical alerts map to the same incident
    let dedupKey = alert.fingerprint ? `prometheus-${alert.fingerprint}` : '';

    if (!dedupKey) {
      const labels = alert.labels || {};
      const sortedKeys = Object.keys(labels).sort();
      const signature = sortedKeys.map(k => `${k}=${labels[k]}`).join(',');

      // Hash the signature to create a database-safe dedup key
      if (signature) {
        const hash = crypto.createHash('sha256').update(signature).digest('hex');
        dedupKey = `prometheus-${hash}`;
      } else {
        // Fallback: use alertname or summary for stable key
        dedupKey = `prometheus-${(alert.labels?.alertname || summary).replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;
      }
    }

    const severity = normalizeSeverity(alert.labels?.severity, 'warning');

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary,
        source: 'Prometheus Alertmanager',
        severity,
        custom_details: {
          version: payload.version,
          groupKey: payload.groupKey,
          status: payload.status,
          receiver: payload.receiver,
          groupLabels: payload.groupLabels,
          commonLabels: payload.commonLabels,
          commonAnnotations: payload.commonAnnotations,
          externalURL: payload.externalURL,
          alert: {
            status: alert.status,
            labels: alert.labels,
            annotations: alert.annotations,
            startsAt: alert.startsAt,
            endsAt: alert.endsAt,
            generatorURL: alert.generatorURL,
            fingerprint: alert.fingerprint,
          },
          allAlerts: payload.alerts,
        },
      },
    };
  });
}
