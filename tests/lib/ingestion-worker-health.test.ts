import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateIngestionWorkerHealth } from '@/lib/ingestion/worker-health';

beforeEach(() =>
  updateIngestionWorkerHealth({
    running: false,
    faulted: false,
    retentionFaulted: false,
    lastSuccessAt: null,
  })
);

describe('ingestion process health across emitted module instances', () => {
  it('exports worker gauges, counters and histograms from a separately loaded scrape module', async () => {
    const worker = await import('@/lib/metrics/operational/registry');
    worker.clearRuntimeOperationalMetrics();
    worker.setOperationalGauge('opsknight_ingestion_active_events', 2);
    worker.addOperationalMetric('opsknight_ingestion_processing_total', 1, {
      outcome: 'completed',
    });
    worker.observeOperationalHistogram('opsknight_ingestion_completion_latency_ms', 123);
    vi.resetModules();
    const scrape = await import('@/lib/metrics/operational/registry');
    try {
      const text = new scrape.OperationalMetricSnapshot().render();
      expect(text).toContain('opsknight_ingestion_active_events 2');
      expect(text).toContain('opsknight_ingestion_processing_total{outcome="completed"} 1');
      expect(text).toContain('opsknight_ingestion_completion_latency_ms_count 1');
      scrape.setOperationalGauge('opsknight_ingestion_active_events', 0);
      expect(
        worker.runtimeOperationalMetrics().get('opsknight_ingestion_active_events')?.at(0)?.value
      ).toBe(0);
    } finally {
      worker.clearRuntimeOperationalMetrics();
      scrape.clearRuntimeOperationalMetrics();
    }
  });

  it('shares instrumentation evidence with a separately loaded route module', async () => {
    const instrumentation = await import('@/lib/ingestion/worker-health');
    instrumentation.updateIngestionWorkerHealth({ running: true, lastSuccessAt: 1234 });
    vi.resetModules();
    const route = await import('@/lib/ingestion/worker-health');
    expect(route.getIngestionWorkerHealth()).toMatchObject({ running: true, lastSuccessAt: 1234 });
    route.updateIngestionWorkerHealth({ faulted: true });
    expect(instrumentation.getIngestionWorkerHealth().faulted).toBe(true);
  });
});
