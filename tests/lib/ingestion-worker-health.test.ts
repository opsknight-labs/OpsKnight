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
