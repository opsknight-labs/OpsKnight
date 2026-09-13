import {
  OPERATIONAL_METRICS,
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
  type MetricDefinition,
} from './registry';

export const RESPONDER_OPERATIONAL_METRICS = [
  {
    name: 'opsknight_responder_dashboard_duration_seconds',
    help: 'Time spent calculating the bounded responder dashboard read model',
    kind: 'histogram',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 16,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  },
  {
    name: 'opsknight_responder_dashboard_inflight',
    help: 'Responder dashboard calculations currently running on this instance',
    kind: 'gauge',
    labels: [],
    scope: 'instance',
    estimatedMaxSeries: 1,
  },
  {
    name: 'opsknight_responder_dashboard_cache_hits_total',
    help: 'Responder dashboard cache lookups by bounded result state',
    kind: 'counter',
    labels: ['state'],
    scope: 'counter',
    estimatedMaxSeries: 3,
  },
  {
    name: 'opsknight_responder_dashboard_failures_total',
    help: 'Failed responder dashboard calculations',
    kind: 'counter',
    labels: [],
    scope: 'counter',
    estimatedMaxSeries: 1,
  },
] as const satisfies readonly MetricDefinition[];

type ResponderMetricName = (typeof RESPONDER_OPERATIONAL_METRICS)[number]['name'];
type CacheState = 'fresh' | 'stale' | 'miss';

let registered = false;

/**
 * Extend the canonical operational registry with the responder read-model
 * metrics. The registry is a process singleton; guard registration so test
 * module reloads and multiple imports cannot create duplicate definitions.
 */
export function registerResponderOperationalMetrics() {
  if (registered) return;

  const registry = OPERATIONAL_METRICS as unknown as MetricDefinition[];
  const existing = new Set(registry.map(definition => definition.name));
  for (const definition of RESPONDER_OPERATIONAL_METRICS) {
    if (!existing.has(definition.name)) registry.push(definition);
  }
  registered = true;
}

function asRegisteredName(name: ResponderMetricName) {
  // The canonical registry's compile-time union is derived from its static
  // definitions. This extension registers the definitions at runtime before
  // delegating, while keeping callers restricted to the typed responder names.
  return name as Parameters<typeof addOperationalMetric>[0];
}

export function setResponderInflight(value: number) {
  registerResponderOperationalMetrics();
  setOperationalGauge(
    asRegisteredName('opsknight_responder_dashboard_inflight') as Parameters<
      typeof setOperationalGauge
    >[0],
    value
  );
}

export function observeResponderDuration(seconds: number) {
  registerResponderOperationalMetrics();
  observeOperationalHistogram(
    asRegisteredName('opsknight_responder_dashboard_duration_seconds') as Parameters<
      typeof observeOperationalHistogram
    >[0],
    seconds
  );
}

export function addResponderFailure() {
  registerResponderOperationalMetrics();
  addOperationalMetric(asRegisteredName('opsknight_responder_dashboard_failures_total'), 1);
}

export function addResponderCacheLookup(state: CacheState) {
  registerResponderOperationalMetrics();
  addOperationalMetric(asRegisteredName('opsknight_responder_dashboard_cache_hits_total'), 1, {
    state,
  });
}

registerResponderOperationalMetrics();
