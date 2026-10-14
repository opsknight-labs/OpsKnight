import { expect, it, vi } from 'vitest';
vi.mock('@/lib/runbooks/worker-heartbeats', () => ({ getRunbookWorkerEvidence: vi.fn() }));
vi.mock('@/lib/runbooks/reconciler', () => ({ reconcileRunbooks: vi.fn() }));
import { getRunbookWorkerEvidence } from '@/lib/runbooks/worker-heartbeats';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import { runRunbookWatchdog } from '@/lib/runbooks/watchdog';
it('runs bounded reconciliation independently when dispatch workers are missing', async () => {
  vi.mocked(getRunbookWorkerEvidence).mockResolvedValue({
    status: 'UNKNOWN',
    instances: 0,
    healthyInstances: 0,
    reason: 'missing',
  });
  await runRunbookWatchdog();
  expect(reconcileRunbooks).toHaveBeenCalledWith(100);
});
it('does not duplicate a healthy worker reconciliation sweep', async () => {
  vi.mocked(reconcileRunbooks).mockClear();
  vi.mocked(getRunbookWorkerEvidence).mockResolvedValue({
    status: 'HEALTHY',
    instances: 1,
    healthyInstances: 1,
    reason: 'fresh',
  });
  await runRunbookWatchdog();
  expect(reconcileRunbooks).not.toHaveBeenCalled();
});
