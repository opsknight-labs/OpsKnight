export type MetricScope = 'instance' | 'cluster_snapshot' | 'counter';
export type MetricKind = 'counter' | 'gauge' | 'histogram';
export type MetricDefinition = {
  name: `opsknight_${string}`;
  help: string;
  kind: MetricKind;
  labels: readonly string[];
  scope: MetricScope;
  estimatedMaxSeries: number;
  buckets?: readonly number[];
};

const FORBIDDEN_LABELS = new Set([
  'incidentId',
  'dedupKey',
  'userId',
  'email',
  'phone',
  'serviceId',
  'teamId',
  'scheduleId',
  'policyId',
  'providerAccountId',
  'webhookUrl',
  'requestId',
  'ip',
  'exceptionMessage',
]);

export const OPERATIONAL_METRICS = [
  {
    name: 'opsknight_dashboard_shell_duration_seconds',
    help: 'Time spent loading the bounded operational dashboard shell',
    kind: 'histogram',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 16,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  },
  {
    name: 'opsknight_dashboard_analytics_duration_seconds',
    help: 'Time spent calculating an isolated dashboard analytics projection',
    kind: 'histogram',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 16,
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  },
  {
    name: 'opsknight_dashboard_analytics_inflight',
    help: 'Dashboard analytics calculations currently running on this instance',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_dashboard_analytics_cache_hits_total',
    help: 'Dashboard analytics cache lookups by bounded result state',
    kind: 'counter',
    labels: ['state'],
    scope: 'counter',
    estimatedMaxSeries: 3,
  },
  {
    name: 'opsknight_dashboard_analytics_failures_total',
    help: 'Failed dashboard analytics calculations',
    kind: 'counter',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_dashboard_analytics_stale_served_total',
    help: 'Stale dashboard analytics snapshots served while refreshing',
    kind: 'counter',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_http_requests_total',
    help: 'Completed HTTP requests by normalized route and status class',
    kind: 'counter',
    labels: ['method', 'route', 'status_class'],
    scope: 'counter',
    estimatedMaxSeries: 600,
  },
  {
    name: 'opsknight_http_request_duration_seconds',
    help: 'HTTP request duration by normalized route',
    kind: 'histogram',
    labels: ['method', 'route'],
    scope: 'counter',
    estimatedMaxSeries: 200,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
  {
    name: 'opsknight_http_requests_in_flight',
    help: 'HTTP requests currently in flight by normalized route',
    kind: 'gauge',
    labels: ['route'],
    scope: 'instance',
    estimatedMaxSeries: 100,
  },
  {
    name: 'opsknight_build_info',
    help: 'Build information',
    kind: 'gauge',
    labels: ['version'],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_active_incidents',
    help: 'Current active incident count',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_active_users',
    help: 'Current active user count',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_jobs_pending',
    help: 'Pending durable jobs by bounded type',
    kind: 'gauge',
    labels: ['type'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 32,
  },
  {
    name: 'opsknight_job_queue',
    help: 'Legacy durable job queue count by bounded status',
    kind: 'gauge',
    labels: ['status'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 8,
  },
  {
    name: 'opsknight_jobs_processing',
    help: 'Processing durable jobs by bounded type',
    kind: 'gauge',
    labels: ['type'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 32,
  },
  {
    name: 'opsknight_jobs_oldest_pending_age_seconds',
    help: 'Age of oldest pending durable job by bounded type',
    kind: 'gauge',
    labels: ['type'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 32,
  },
  {
    name: 'opsknight_notifications_undelivered',
    help: 'Pending or retryable failed notification deliveries',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_notifications_oldest_undelivered_age_seconds',
    help: 'Age of the oldest pending or retryable failed notification',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_escalations_overdue',
    help: 'Incidents whose next escalation execution is overdue',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_escalation_max_lag_seconds',
    help: 'Maximum execution lag among overdue escalations',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_rollup_freshness_age_seconds',
    help: 'Age since the newest daily metric rollup was updated',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_incident_sla_legacy_captures',
    help: 'Durable cumulative count of incidents captured by the transitional database SLA fallback',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_incident_sla_legacy_capture_last_seen_age_seconds',
    help: 'Age of the newest transitional database SLA fallback capture',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_metrics_collection_errors',
    help: 'Collectors that failed in the latest scrape snapshot',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_metrics_cache_hits_total',
    help: 'Metrics snapshot cache hits',
    kind: 'counter',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_metrics_cache_misses_total',
    help: 'Metrics snapshot cache misses',
    kind: 'counter',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_metrics_cache_age_seconds',
    help: 'Age of the current process-local metrics snapshot',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_integration_reconciliations_total',
    help: 'Expired or ambiguous integration work reclaimed by bounded kind',
    kind: 'counter',
    labels: ['kind'],
    scope: 'counter',
    estimatedMaxSeries: 8,
  },
  {
    name: 'opsknight_external_operations',
    help: 'Durable external operations by bounded status',
    kind: 'gauge',
    labels: ['status'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 8,
  },
  {
    name: 'opsknight_chatops_intents',
    help: 'Durable ChatOps intents by bounded status',
    kind: 'gauge',
    labels: ['status'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 8,
  },
  {
    name: 'opsknight_inbound_deliveries',
    help: 'Inbound provider deliveries by bounded status',
    kind: 'gauge',
    labels: ['status'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 8,
  },
  {
    name: 'opsknight_provider_cooldown',
    help: 'Whether a distributed provider key class has active cooldowns',
    kind: 'gauge',
    labels: ['provider'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 16,
  },
  {
    name: 'opsknight_realtime_subscribers',
    help: 'Active realtime subscribers on this application instance',
    kind: 'gauge',
    labels: ['stream'],
    scope: 'instance',
    estimatedMaxSeries: 2,
  },
  {
    name: 'opsknight_realtime_observed_generation',
    help: 'Newest durable realtime generation observed by this application instance',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_realtime_change_age_seconds',
    help: 'Age of the newest durable realtime change observed by this application instance',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_realtime_clock_errors_total',
    help: 'Failed reads of the durable realtime change clock',
    kind: 'counter',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_status_page_projection_duration_seconds',
    help: 'Origin time spent building a public status projection by bounded surface',
    kind: 'histogram',
    labels: ['surface'],
    scope: 'counter',
    estimatedMaxSeries: 8,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
  {
    name: 'opsknight_status_page_fanout_total',
    help: 'Status-page subscriber fanout outcomes by bounded event and outcome',
    kind: 'counter',
    labels: ['event', 'outcome'],
    scope: 'counter',
    estimatedMaxSeries: 12,
  },
  {
    name: 'opsknight_status_page_snapshot_dirty',
    help: 'Status-page snapshots whose source revision has not been published',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_status_page_snapshot_oldest_age_seconds',
    help: 'Age of the oldest generated status-page snapshot',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_status_page_snapshot_rebuild_total',
    help: 'Status-page snapshot reconciliation outcomes',
    kind: 'counter',
    labels: ['outcome'],
    scope: 'counter',
    estimatedMaxSeries: 2,
  },
  {
    name: 'opsknight_status_page_snapshot_build_duration_seconds',
    help: 'Bounded status snapshot candidate build time by publication phase',
    kind: 'histogram',
    labels: ['phase'],
    scope: 'counter',
    estimatedMaxSeries: 6,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  },
  {
    name: 'opsknight_status_page_snapshot_bytes',
    help: 'Serialized bytes in the most recently built public status snapshot',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_notification_queue_depth',
    help: 'Ready notification queue depth by traffic class, provider and channel',
    kind: 'gauge',
    labels: ['traffic_class', 'provider', 'channel'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 256,
  },
  {
    name: 'opsknight_notification_oldest_age_seconds',
    help: 'Age of the oldest ready notification by traffic class',
    kind: 'gauge',
    labels: ['traffic_class'],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 4,
  },
  {
    name: 'opsknight_notification_throughput_per_second',
    help: 'Notification provider acceptances by provider and traffic class',
    kind: 'counter',
    labels: ['provider', 'traffic_class'],
    scope: 'counter',
    estimatedMaxSeries: 128,
  },
  {
    name: 'opsknight_notification_effective_rate',
    help: 'Current adaptive provider delivery rate',
    kind: 'gauge',
    labels: ['provider', 'channel'],
    scope: 'instance',
    estimatedMaxSeries: 128,
  },
  {
    name: 'opsknight_notification_admission_deferred_total',
    help: 'Provider admissions deferred by bounded reason',
    kind: 'counter',
    labels: ['reason', 'traffic_class'],
    scope: 'counter',
    estimatedMaxSeries: 16,
  },
  {
    name: 'opsknight_notification_provider_429_total',
    help: 'Provider rate-limit responses by provider',
    kind: 'counter',
    labels: ['provider'],
    scope: 'counter',
    estimatedMaxSeries: 32,
  },
  {
    name: 'opsknight_status_fanout_campaign_total',
    help: 'Fanout campaigns by terminal outcome',
    kind: 'counter',
    labels: ['outcome'],
    scope: 'counter',
    estimatedMaxSeries: 4,
  },
  {
    name: 'opsknight_status_fanout_materialized',
    help: 'Subscriber intents materialized into the durable queue',
    kind: 'counter',
    labels: ['traffic_class'],
    scope: 'counter',
    estimatedMaxSeries: 4,
  },
  {
    name: 'opsknight_status_fanout_failed',
    help: 'Subscriber intents that failed during materialization',
    kind: 'counter',
    labels: ['traffic_class'],
    scope: 'counter',
    estimatedMaxSeries: 4,
  },
  {
    name: 'opsknight_status_snapshot_revision_lag',
    help: 'Unpublished status snapshot revisions',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_status_serving_store_latency_seconds',
    help: 'Status serving-store operation latency',
    kind: 'histogram',
    labels: ['operation'],
    scope: 'counter',
    estimatedMaxSeries: 8,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  },
  {
    name: 'opsknight_status_serving_store_errors_total',
    help: 'Status serving-store failures by operation',
    kind: 'counter',
    labels: ['operation'],
    scope: 'counter',
    estimatedMaxSeries: 8,
  },
  {
    name: 'opsknight_status_page_publication_duration_seconds',
    help: 'Synchronous status-page publication latency by change class and outcome',
    kind: 'histogram',
    labels: ['change_class', 'outcome'],
    scope: 'counter',
    estimatedMaxSeries: 48,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  },
  {
    name: 'opsknight_status_page_publication_total',
    help: 'Status-page publication attempts by dominant change class and outcome',
    kind: 'counter',
    labels: ['change_class', 'outcome'],
    scope: 'counter',
    estimatedMaxSeries: 48,
  },
  {
    name: 'opsknight_status_page_route_switches_total',
    help: 'Status-page route switch outcomes',
    kind: 'counter',
    labels: ['outcome'],
    scope: 'counter',
    estimatedMaxSeries: 4,
  },
  {
    name: 'opsknight_status_page_publication_failed',
    help: 'Status pages whose last publication attempt failed',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_status_page_fail_closed',
    help: 'Status pages currently withheld from public serving',
    kind: 'gauge',
    labels: [],
    scope: 'cluster_snapshot',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_status_page_stale_serves_total',
    help: 'Public status reads served from the last known good projection',
    kind: 'counter',
    labels: ['surface'],
    scope: 'counter',
    estimatedMaxSeries: 4,
  },
  {
    name: 'opsknight_status_page_revocations_total',
    help: 'Status-page serving revocations by reason',
    kind: 'counter',
    labels: ['reason'],
    scope: 'counter',
    estimatedMaxSeries: 4,
  },
] as const satisfies readonly MetricDefinition[];

type RegisteredMetricName = (typeof OPERATIONAL_METRICS)[number]['name'];
type RuntimeRow = { labels: Record<string, string>; value: number };
const runtimeValues = new Map<RegisteredMetricName, Map<string, RuntimeRow>>();
type HistogramRow = RuntimeRow & { count: number; buckets: number[] };
const runtimeHistograms = new Map<RegisteredMetricName, Map<string, HistogramRow>>();

function runtimeKey(labels: Record<string, string>) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function assertLabels(name: RegisteredMetricName, labels: Record<string, string>) {
  const definition = OPERATIONAL_METRICS.find(metric => metric.name === name);
  if (!definition) throw new Error(`Unregistered metric: ${name}`);
  if (Object.keys(labels).sort().join(',') !== [...definition.labels].sort().join(',')) {
    throw new Error(`Invalid labels for ${name}`);
  }
  return definition;
}

export function addOperationalMetric(
  name: RegisteredMetricName,
  value: number,
  labels: Record<string, string> = {}
) {
  const definition = assertLabels(name, labels);
  if (definition.kind !== 'counter') throw new Error(`Cannot add to non-counter metric: ${name}`);
  const rows = runtimeValues.get(name) ?? new Map<string, RuntimeRow>();
  const key = runtimeKey(labels);
  const current = rows.get(key)?.value ?? 0;
  rows.set(key, { labels, value: current + Math.max(0, Number.isFinite(value) ? value : 0) });
  runtimeValues.set(name, rows);
}

export function observeOperationalHistogram(
  name: RegisteredMetricName,
  value: number,
  labels: Record<string, string> = {}
) {
  const definition = assertLabels(name, labels);
  if (definition.kind !== 'histogram')
    throw new Error(`Cannot observe non-histogram metric: ${name}`);
  const observation = Math.max(0, Number.isFinite(value) ? value : 0);
  const boundaries = definition.buckets ?? [];
  const rows = runtimeHistograms.get(name) ?? new Map<string, HistogramRow>();
  const key = runtimeKey(labels);
  const current = rows.get(key) ?? { labels, value: 0, count: 0, buckets: boundaries.map(() => 0) };
  rows.set(key, {
    labels,
    value: current.value + observation,
    count: current.count + 1,
    buckets: boundaries.map(
      (boundary, index) => (current.buckets.at(index) ?? 0) + (observation <= boundary ? 1 : 0)
    ),
  });
  runtimeHistograms.set(name, rows);
}

export function setOperationalGauge(
  name: RegisteredMetricName,
  value: number,
  labels: Record<string, string> = {}
) {
  const definition = assertLabels(name, labels);
  if (definition.kind !== 'gauge') throw new Error(`Cannot set non-gauge metric: ${name}`);
  const rows = runtimeValues.get(name) ?? new Map<string, RuntimeRow>();
  rows.set(runtimeKey(labels), { labels, value: Number.isFinite(value) ? value : 0 });
  runtimeValues.set(name, rows);
}

export function runtimeOperationalMetrics() {
  return new Map(
    [...runtimeValues].map(([name, rows]) => [name, [...rows.values()].map(row => ({ ...row }))])
  );
}

export function clearRuntimeOperationalMetrics() {
  runtimeValues.clear();
  runtimeHistograms.clear();
}

export const ACTIVE_SERIES_BUDGET = 10_000;

export function validateMetricDefinitions(
  definitions: readonly MetricDefinition[] = OPERATIONAL_METRICS
) {
  const names = new Set<string>();
  let estimatedSeries = 0;
  for (const definition of definitions) {
    if (names.has(definition.name)) throw new Error(`Duplicate metric: ${definition.name}`);
    names.add(definition.name);
    for (const label of definition.labels) {
      if (FORBIDDEN_LABELS.has(label)) throw new Error(`Forbidden metric label: ${label}`);
    }
    estimatedSeries += definition.estimatedMaxSeries;
  }
  if (estimatedSeries > ACTIVE_SERIES_BUDGET) {
    throw new Error(`Metric series budget exceeded: ${estimatedSeries}`);
  }
  return { estimatedSeries };
}

export function escapePrometheusLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export class OperationalMetricSnapshot {
  private readonly values = new Map<
    string,
    Array<{ labels: Record<string, string>; value: number }>
  >();

  set(name: RegisteredMetricName, value: number, labels: Record<string, string> = {}) {
    assertLabels(name, labels);
    const rows = this.values.get(name) ?? [];
    rows.push({ labels, value: Number.isFinite(value) ? value : 0 });
    this.values.set(name, rows);
  }

  render(): string {
    validateMetricDefinitions();
    for (const [name, rows] of runtimeOperationalMetrics()) {
      for (const row of rows) this.set(name, row.value, row.labels);
    }
    const lines: string[] = [];
    for (const definition of OPERATIONAL_METRICS) {
      const rows = this.values.get(definition.name);
      const histogramRows = runtimeHistograms.get(definition.name);
      if (!rows?.length && !histogramRows?.size) continue;
      lines.push(`# HELP ${definition.name} ${definition.help}`);
      lines.push(`# TYPE ${definition.name} ${definition.kind}`);
      if (definition.kind === 'histogram' && histogramRows) {
        for (const row of histogramRows.values()) {
          const rowLabels = new Map(Object.entries(row.labels));
          const baseLabels = definition.labels.map(
            label => `${label}="${escapePrometheusLabel(rowLabels.get(label) ?? 'other')}"`
          );
          for (const [index, boundary] of (definition.buckets ?? []).entries()) {
            lines.push(
              `${definition.name}_bucket{${[...baseLabels, `le="${boundary}"`].join(',')}} ${row.buckets.at(index) ?? 0}`
            );
          }
          lines.push(
            `${definition.name}_bucket{${[...baseLabels, 'le="+Inf"'].join(',')}} ${row.count}`
          );
          const labelText = baseLabels.length ? `{${baseLabels.join(',')}}` : '';
          lines.push(`${definition.name}_sum${labelText} ${row.value}`);
          lines.push(`${definition.name}_count${labelText} ${row.count}`);
        }
        continue;
      }
      for (const row of rows ?? []) {
        const rowLabels = new Map(Object.entries(row.labels));
        const labelText = definition.labels.length
          ? `{${definition.labels.map(label => `${label}="${escapePrometheusLabel(rowLabels.get(label) ?? 'other')}"`).join(',')}}`
          : '';
        lines.push(`${definition.name}${labelText} ${row.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}
