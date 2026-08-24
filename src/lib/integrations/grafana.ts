/**
 * Grafana Integration Handler
 * Transforms Grafana alert webhooks to standard event format
 */

import crypto from 'crypto';
import { normalizeSeverity } from './normalization';

export type GrafanaAlert = {
  title?: string;
  message?: string;
  state?: 'alerting' | 'ok' | 'no_data' | 'pending' | 'paused';
  ruleId?: number;
  ruleName?: string;
  ruleUrl?: string;
  evalMatches?: Array<{
    metric: string;
    value: number;
    tags?: Record<string, string>;
  }>;
  tags?: Record<string, string>;
  dashboardId?: number;
  panelId?: number;
  orgId?: number;
  // Alertmanager format fields
  receiver?: string;
  groupKey?: string;
  alerts?: Array<{
    status: string;
    labels: Record<string, string>;
    annotations?: Record<string, string>;
    startsAt: string;
    endsAt?: string;
  }>;
  status?: string;
  groupLabels?: Record<string, string>;
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
};

export type GrafanaStandardEvent = {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
};

export function transformGrafanaToEvent(
  payload: GrafanaAlert
): GrafanaStandardEvent | GrafanaStandardEvent[] {
  // Handle new Grafana alert format
  if (payload.state !== undefined || payload.ruleName) {
    const isResolved = payload.state === 'ok';
    const summary = payload.title || payload.ruleName || payload.message || 'Grafana Alert';
    // Use ruleId if available, otherwise create stable key from ruleName/title
    // Avoids Date.now() which defeats deduplication
    const dedupKey = payload.ruleId
      ? `grafana-${payload.ruleId}`
      : `grafana-${(payload.ruleName || payload.title || 'unknown').replace(/\s+/g, '-').toLowerCase()}`;

    const severity =
      payload.state === 'alerting' ? 'critical' : payload.state === 'no_data' ? 'warning' : 'info';

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary,
        source: 'Grafana',
        severity,
        custom_details: {
          ruleId: payload.ruleId,
          ruleName: payload.ruleName,
          ruleUrl: payload.ruleUrl,
          state: payload.state,
          message: payload.message,
          evalMatches: payload.evalMatches,
          tags: payload.tags,
          dashboardId: payload.dashboardId,
          panelId: payload.panelId,
        },
      },
    };
  }

  // Handle Prometheus Alertmanager format (Grafana Unified Alerting can send this)
  if (payload.alerts && Array.isArray(payload.alerts)) {
    if (payload.alerts.length === 0) {
      return [
        {
          event_action: 'acknowledge' as const,
          dedup_key: `grafana-empty-${payload.receiver || payload.groupKey || 'unknown'}`,
          payload: {
            summary: 'Grafana alert received: empty alerts array',
            source: 'Grafana',
            severity: 'info' as const,
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
        'Grafana Alert';

      const alertName = alert.labels?.alertname || 'alert';
      const instance = alert.labels?.instance;
      const dedupKey = instance
        ? `grafana-${alertName}-${instance}`.slice(0, 512)
        : `grafana-${alertName}`.slice(0, 512);

      return {
        event_action: isResolved ? ('resolve' as const) : ('trigger' as const),
        dedup_key: dedupKey,
        payload: {
          summary,
          source: 'Grafana',
          severity: normalizeSeverity(alert.labels?.severity, 'warning'),
          custom_details: {
            status: payload.status,
            labels: alert.labels,
            annotations: alert.annotations,
            startsAt: alert.startsAt,
            endsAt: alert.endsAt,
            groupLabels: payload.groupLabels,
            commonLabels: payload.commonLabels,
            commonAnnotations: payload.commonAnnotations,
          },
        },
      };
    });
  }

  // Fallback for unsupported payload formats
  return [
    {
      event_action: 'acknowledge' as const,
      dedup_key: `grafana-unknown-${payload.title || payload.ruleName || 'fallback'}`,
      payload: {
        summary: 'Grafana event received: unknown format',
        source: 'Grafana',
        severity: 'info' as const,
        custom_details: payload,
      },
    },
  ];
}

export function transformGrafanaToEvents(payload: GrafanaAlert) {
  const result = transformGrafanaToEvent(payload);
  return Array.isArray(result) ? result : [result];
}
