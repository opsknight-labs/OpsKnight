/**
 * Grafana Integration Handler
 * Transforms Grafana alert webhooks to standard event format
 */

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
    fingerprint?: string;
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

/**
 * Grafana's default notification template ("simple" webhook) sends the alert as
 * one `message` string: "Value: …", "Labels:\n - k = v", "Annotations:\n - k = v".
 * Pull those fields out so the incident gets a real title, grouping and severity.
 * shortcut: reads the first alert only when Grafana groups several into one
 * message; upgrade by splitting on "Value:" if grouped simple webhooks show up.
 */
export function parseGrafanaMessage(message: string | undefined): {
  value?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
} {
  const labels: Record<string, string> = {};
  const annotations: Record<string, string> = {};
  let value: string | undefined;
  let section: Record<string, string> | null = null;
  for (const rawLine of (message ?? '').split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('Value:')) {
      if (value !== undefined) break; // second alert in a grouped message
      value = line.slice('Value:'.length).trim();
      section = null;
    } else if (line === 'Labels:') {
      section = labels;
    } else if (line === 'Annotations:') {
      section = annotations;
    } else if (section && line.startsWith('- ') && line.includes(' = ')) {
      const item = line.slice(2);
      const at = item.indexOf(' = ');
      section[item.slice(0, at).trim()] = item.slice(at + 3).trim();
    } else if (line) {
      section = null;
    }
  }
  return { value, labels, annotations };
}

export function transformGrafanaToEvent(
  payload: GrafanaAlert
): GrafanaStandardEvent | GrafanaStandardEvent[] {
  // Legacy (pre-unified) Grafana alert format. Unified alerting also sends top-level
  // state/title next to alerts[], so a non-empty alerts[] always takes the per-alert path.
  const hasAlerts = Array.isArray(payload.alerts) && payload.alerts.length > 0;
  if (!hasAlerts && (payload.state !== undefined || payload.ruleName)) {
    const isResolved = payload.state === 'ok';
    const parsed = parseGrafanaMessage(payload.message);
    const alertName = parsed.labels.alertname;
    const summary =
      payload.title ||
      payload.ruleName ||
      parsed.annotations.summary ||
      alertName ||
      payload.message
        ?.split('\n')
        .find(line => line.trim())
        ?.trim() ||
      'Grafana Alert';
    // Stable key (never Date.now(), which defeats deduplication). Without rule
    // identity, the alert's labels identify it, so different alerts stay apart.
    const labelKey = Object.entries(parsed.labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    const dedupKey = payload.ruleId
      ? `grafana-${payload.ruleId}`
      : payload.ruleName || payload.title
        ? `grafana-${(payload.ruleName || payload.title)!.replace(/\s+/g, '-').toLowerCase()}`
        : labelKey
          ? `grafana-${labelKey}`.slice(0, 512)
          : 'grafana-unknown';

    const severity = parsed.labels.severity
      ? normalizeSeverity(parsed.labels.severity, 'critical')
      : payload.state === 'alerting'
        ? 'critical'
        : payload.state === 'no_data'
          ? 'warning'
          : 'info';

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
          ...(parsed.value !== undefined && { value: parsed.value }),
          ...(Object.keys(parsed.labels).length > 0 && { labels: parsed.labels }),
          ...(Object.keys(parsed.annotations).length > 0 && { annotations: parsed.annotations }),
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
      // The fingerprint identifies the full label set, so alerts sharing an alertname stay apart.
      const dedupKey = alert.fingerprint
        ? `grafana-${alert.fingerprint}`.slice(0, 512)
        : instance
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
