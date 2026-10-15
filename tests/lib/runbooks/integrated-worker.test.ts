import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { processPendingJobsByType } from '@/lib/jobs/queue';
import { recordWorkerHeartbeat } from '@/lib/runbooks/worker-heartbeats';
import {
  startIntegratedRunbookWorker,
  stopIntegratedRunbookWorker,
} from '@/lib/runbooks/integrated-worker';
vi.mock('@/lib/jobs/queue', () => ({ processPendingJobsByType: vi.fn() }));
vi.mock('@/lib/job-worker', () => ({
  getJobWorkerConfig: () => ({
    batchSize: 100,
    concurrency: 15,
    busyPollMs: 100,
    idlePollMs: 1000,
  }),
}));
vi.mock('@/lib/runbooks/reconciler', () => ({
  reconcileRunbooks: vi.fn().mockResolvedValue({ reconciled: 0 }),
}));
vi.mock('@/lib/runbooks/worker-heartbeats', () => ({
  recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(processPendingJobsByType).mockResolvedValue({ total: 0, processed: 0, failed: 0 });
});
afterEach(async () => {
  await stopIntegratedRunbookWorker();
  vi.useRealTimers();
});
it('certifies the integrated runbook lane independently of its general worker', async () => {
  startIntegratedRunbookWorker();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(recordWorkerHeartbeat).toHaveBeenLastCalledWith(
    expect.objectContaining({
      role: 'integrated',
      lane: 'runbook',
      runbookEnabled: true,
      running: true,
      lastSuccessAt: expect.any(Date),
      lastReconciledAt: expect.any(Date),
      lastError: null,
    })
  );
  await stopIntegratedRunbookWorker();
  expect(recordWorkerHeartbeat).toHaveBeenLastCalledWith(
    expect.objectContaining({ running: false })
  );
});
it('reports a failed integrated dispatch even when the queue is otherwise idle', async () => {
  vi.mocked(processPendingJobsByType).mockResolvedValue({ total: 1, processed: 0, failed: 1 });
  startIntegratedRunbookWorker();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(recordWorkerHeartbeat).toHaveBeenLastCalledWith(
    expect.objectContaining({ lastSuccessAt: null, lastError: '1 runbook job(s) failed' })
  );
});
