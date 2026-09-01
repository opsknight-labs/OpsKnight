import { beforeEach, describe, expect, it } from 'vitest';
import {
  addOperationalMetric,
  clearRuntimeOperationalMetrics,
  OperationalMetricSnapshot,
  runtimeOperationalMetrics,
  setOperationalGauge,
  validateMetricDefinitions,
} from '@/lib/metrics/operational/registry';

describe('operational metric registry', () => {
  beforeEach(() => clearRuntimeOperationalMetrics());

  it('stays within the declared cardinality budget', () => {
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
});
