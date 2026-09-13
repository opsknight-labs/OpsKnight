import { beforeEach, describe, expect, it } from 'vitest';
import {
  addOperationalMetric,
  clearRuntimeOperationalMetrics,
  OperationalMetricSnapshot,
  observeOperationalHistogram,
  runtimeOperationalMetrics,
  setOperationalGauge,
  validateMetricDefinitions,
} from '@/lib/metrics/operational/registry';
import {
  addResponderCacheLookup,
  addResponderFailure,
  observeResponderDuration,
  registerResponderOperationalMetrics,
  setResponderInflight,
} from '@/lib/metrics/operational/responder-registry';

describe('operational metric registry', () => {
  beforeEach(() => clearRuntimeOperationalMetrics());

  it('stays within the declared cardinality budget', () => {
    registerResponderOperationalMetrics();
    expect(validateMetricDefinitions().estimatedSeries).toBeLessThan(10_000);
  });

  it('emits HELP and TYPE exactly once and escapes labels', () => {
    const snapshot = new OperationalMetricSnapshot();
    snapshot.set('opsknight_jobs_pending', 2, { type: 'notify"batch' });
    snapshot.set('opsknight_jobs_pending', 1, { type: 'escalation' });
    const rendered = snapshot.render();
    expect(rendered.match(/# HELP opsknight_jobs_pending/g)).toHaveLength(1);
    expect(rendered.match(/# TYPE opsknight_jobs_pending/g)).toHaveLength(1);
    expect(rendered).toContain('type="notify\\"batch"');
  });

  it('rejects undeclared label shapes', () => {
    const snapshot = new OperationalMetricSnapshot();
    expect(() => snapshot.set('opsknight_jobs_pending', 1, { incidentId: 'secret' })).toThrow();
  });

  it('accumulates counters and replaces gauges', () => {
    const labels = { method: 'GET', route: 'api.health', status_class: '2xx' };
    addOperationalMetric('opsknight_http_requests_total', 1, labels);
    addOperationalMetric('opsknight_http_requests_total', 2, labels);
    setOperationalGauge('opsknight_http_requests_in_flight', 2, { route: 'api.health' });
    setOperationalGauge('opsknight_http_requests_in_flight', 1, { route: 'api.health' });

    const runtime = runtimeOperationalMetrics();
    expect(runtime.get('opsknight_http_requests_total')?.[0]?.value).toBe(3);
    expect(runtime.get('opsknight_http_requests_in_flight')?.[0]?.value).toBe(1);
  });

  it('renders cumulative histogram buckets, sum, and count', () => {
    observeOperationalHistogram('opsknight_http_request_duration_seconds', 0.02, {
      method: 'GET',
      route: 'api.health',
    });
    observeOperationalHistogram('opsknight_http_request_duration_seconds', 0.3, {
      method: 'GET',
      route: 'api.health',
    });

    const rendered = new OperationalMetricSnapshot().render();
    expect(rendered).toContain('# TYPE opsknight_http_request_duration_seconds histogram');
    expect(rendered).toContain('le="0.025"} 1');
    expect(rendered).toContain('le="0.5"} 2');
    expect(rendered).toContain('le="+Inf"} 2');
    expect(rendered).toContain(
      'opsknight_http_request_duration_seconds_count{method="GET",route="api.health"} 2'
    );
  });

  it('registers and renders responder dashboard metrics with bounded labels', () => {
    setResponderInflight(2);
    setResponderInflight(1);
    addResponderCacheLookup('fresh');
    addResponderCacheLookup('miss');
    addResponderFailure();
    observeResponderDuration(0.2);

    const rendered = new OperationalMetricSnapshot().render();
    expect(rendered).toContain('# TYPE opsknight_responder_dashboard_inflight gauge');
    expect(rendered).toContain('opsknight_responder_dashboard_inflight 1');
    expect(rendered).toContain(
      '# TYPE opsknight_responder_dashboard_cache_hits_total counter'
    );
    expect(rendered).toContain(
      'opsknight_responder_dashboard_cache_hits_total{state="fresh"} 1'
    );
    expect(rendered).toContain(
      '# TYPE opsknight_responder_dashboard_duration_seconds histogram'
    );
    expect(rendered).toContain('# TYPE opsknight_responder_dashboard_failures_total counter');
  });
});
