import type { SourceReader } from '../types';
import { normalizeStatus, isHttpUrl } from '../generic';
import { at, has, isObj, labelTags, str } from './helpers';

/**
 * Reference readers for the three most common sources. Each detects its payloads by shape (not by trusting a
 * "source" field alone) and reads only what that tool documents; the generic reader fills the rest.
 */

/** Datadog monitor webhook (the default $-variable template and the classic event payload). */
export const datadog: SourceReader = {
  id: 'datadog',
  name: 'Datadog',
  detect: data =>
    isObj(data) &&
    (String(at(data, 'source') ?? '').toLowerCase() === 'datadog' ||
      has(data, 'alert_type', 'event_type') ||
      (has(data, 'monitor') && (has(data, 'query') || has(data, 'alert_transition')))),
  read: data => {
    const value = str(data, 'value', 'alert_metric_value', 'metric_value');
    const threshold = str(data, 'threshold', 'alert_threshold');
    const tags = at(data, 'tags');
    return {
      title: str(data, 'title', 'alert_title', 'event_title', 'monitor.name'),
      status: normalizeStatus(str(data, 'alert_transition', 'transition', 'status') ?? '') ?? null,
      severity: str(data, 'priority', 'monitor.priority', 'alert_priority')?.toLowerCase() ?? null,
      condition: str(data, 'monitor.name', 'alert_query_name'),
      measured: value ? { value, threshold } : null,
      query: str(data, 'query', 'alert_query')
        ? { language: 'Datadog', text: str(data, 'query', 'alert_query')! }
        : null,
      tags:
        typeof tags === 'string'
          ? tags
              .split(',')
              .map(t => t.trim())
              .filter(Boolean)
          : Array.isArray(tags)
            ? tags.filter((t): t is string => typeof t === 'string')
            : [],
      links: [
        ...(str(data, 'link', 'event_link', 'url') &&
        isHttpUrl(str(data, 'link', 'event_link', 'url')!)
          ? [{ label: 'Open in Datadog', url: str(data, 'link', 'event_link', 'url')! }]
          : []),
      ],
      images: str(data, 'snapshot', 'snapshot_url') ? [str(data, 'snapshot', 'snapshot_url')!] : [],
      message: str(data, 'body', 'event_msg', 'message', 'text'),
    };
  },
};

/** Prometheus Alertmanager webhook (version "4"), also what most Prometheus-compatible stacks forward. */
export const alertmanager: SourceReader = {
  id: 'alertmanager',
  name: 'Prometheus Alertmanager',
  detect: data =>
    isObj(data) &&
    Array.isArray(at(data, 'alerts')) &&
    (has(data, 'groupLabels') || has(data, 'commonLabels') || has(data, 'receiver')) &&
    !has(data, 'orgId'),
  read: data => {
    const first = at(data, 'alerts.0');
    const labels = {
      ...(isObj(at(data, 'commonLabels')) ? (at(data, 'commonLabels') as object) : {}),
    };
    const firstLabels = isObj(at(first, 'labels'))
      ? (at(first, 'labels') as Record<string, unknown>)
      : {};
    const all = { ...firstLabels, ...labels };
    const count = (at(data, 'alerts') as unknown[]).length;
    return {
      title:
        str(data, 'commonAnnotations.summary', 'commonAnnotations.title') ??
        str(first, 'annotations.summary') ??
        str(data, 'commonLabels.alertname', 'groupLabels.alertname') ??
        str(first, 'labels.alertname'),
      status: normalizeStatus(str(data, 'status') ?? '') ?? null,
      severity: (str(all, 'severity', 'priority') ?? null)?.toLowerCase() ?? null,
      condition:
        [str(all, 'alertname'), count > 1 ? `${count} alerts in this group` : null]
          .filter(Boolean)
          .join(' · ') || null,
      message: str(data, 'commonAnnotations.description') ?? str(first, 'annotations.description'),
      tags: labelTags(all, ['alertname', 'severity']),
      links: [
        ...(str(first, 'generatorURL')
          ? [{ label: 'Open in Prometheus', url: str(first, 'generatorURL')! }]
          : []),
        ...(str(data, 'externalURL')
          ? [{ label: 'Alertmanager', url: str(data, 'externalURL')! }]
          : []),
        ...(str(first, 'annotations.runbook_url', 'annotations.runbook')
          ? [
              {
                label: 'Runbook',
                url: str(first, 'annotations.runbook_url', 'annotations.runbook')!,
              },
            ]
          : []),
        ...(str(first, 'annotations.dashboard')
          ? [{ label: 'Dashboard', url: str(first, 'annotations.dashboard')! }]
          : []),
      ].filter(link => isHttpUrl(link.url)),
      when: [
        ...(str(first, 'startsAt') ? [{ label: 'Started', at: str(first, 'startsAt')! }] : []),
        ...(str(first, 'endsAt') && !str(first, 'endsAt')!.startsWith('0001')
          ? [{ label: 'Resolved', at: str(first, 'endsAt')! }]
          : []),
      ],
    };
  },
};

/** Grafana unified alerting webhook (any datasource: Prometheus, Loki, ClickHouse, CloudWatch, SQL…). */
export const grafana: SourceReader = {
  id: 'grafana',
  name: 'Grafana',
  detect: data =>
    isObj(data) &&
    Array.isArray(at(data, 'alerts')) &&
    (has(data, 'orgId') ||
      has(data, 'alerts.0.fingerprint') ||
      has(data, 'alerts.0.silenceURL') ||
      has(data, 'alerts.0.dashboardURL') ||
      has(data, 'alerts.0.valueString')),
  read: data => {
    const first = at(data, 'alerts.0');
    const labels = isObj(at(first, 'labels'))
      ? (at(first, 'labels') as Record<string, unknown>)
      : {};
    const values = at(first, 'values');
    const measured = isObj(values)
      ? Object.entries(values)
          .map(([k, v]) => `${k} = ${v}`)
          .join(', ')
      : str(first, 'valueString');
    return {
      title: str(data, 'title') ?? str(first, 'annotations.summary') ?? str(labels, 'alertname'),
      status: normalizeStatus(str(data, 'status', 'state') ?? '') ?? null,
      severity: str(labels, 'severity', 'priority')?.toLowerCase() ?? null,
      condition: str(labels, 'alertname', 'rulename'),
      measured: measured ? { value: measured, threshold: null } : null,
      message: str(first, 'annotations.description') ?? str(data, 'message'),
      tags: labelTags(labels, ['alertname', 'severity', '__alert_rule_uid__', 'grafana_folder']),
      links: [
        ['Dashboard', str(first, 'dashboardURL')],
        ['Panel', str(first, 'panelURL')],
        ['Open in Grafana', str(first, 'generatorURL')],
        ['Silence', str(first, 'silenceURL')],
        ['Runbook', str(first, 'annotations.runbook_url')],
      ]
        .filter((pair): pair is [string, string] => Boolean(pair[1]) && isHttpUrl(pair[1]!))
        .map(([label, url]) => ({ label, url })),
      images: str(first, 'imageURL') ? [str(first, 'imageURL')!] : [],
      when: str(first, 'startsAt') ? [{ label: 'Started', at: str(first, 'startsAt')! }] : [],
    };
  },
};
