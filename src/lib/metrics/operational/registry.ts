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
