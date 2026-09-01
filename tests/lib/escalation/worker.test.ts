import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processPendingJobsByType: vi.fn(),
  processPendingEscalations: vi.fn(),
  reconcileEscalations: vi.fn(),
}));

vi.mock('@/lib/jobs/queue', () => ({
  processPendingJobsByType: mocks.processPendingJobsByType,
}));

vi.mock('@/lib/escalation/index', () => ({
  processPendingEscalations: mocks.processPendingEscalations,
}));

vi.mock('@/lib/escalation/recovery', () => ({
  reconcileEscalations: mocks.reconcileEscalations,
}));

import {
  consumeEscalationWakeRequest,
  criticalEscalationCycleWasBusy,
  notifyEscalationWorkPending,
  resetCriticalEscalationCadence,
  runCriticalEscalationCycle,
} from '@/lib/escalation/worker';

const T0 = 1_800_000_000_000;

function noRepairs() {
  return {
    executionsInitialized: 0,
    dueJobsRecreated: 0,
    staleJobsCancelled: 0,
    leasesReleased: 0,
    errors: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCriticalEscalationCadence();
  mocks.processPendingJobsByType.mockResolvedValue({ processed: 0, failed: 0, total: 0 });
  mocks.processPendingEscalations.mockResolvedValue({ processed: 0, total: 0 });
  mocks.reconcileEscalations.mockResolvedValue(noRepairs());
});

describe('runCriticalEscalationCycle', () => {
  it('claims only escalation jobs', async () => {
    await runCriticalEscalationCycle({ now: T0, batchSize: 25, concurrency: 5 });

    expect(mocks.processPendingJobsByType).toHaveBeenCalledWith('ESCALATION', 25, 5);
  });

  it('reports what it processed', async () => {
    mocks.processPendingJobsByType.mockResolvedValue({ processed: 3, failed: 1, total: 4 });

    const result = await runCriticalEscalationCycle({ now: T0 });

    expect(result).toMatchObject({ jobsClaimed: 4, jobsProcessed: 3, jobsFailed: 1 });
    expect(criticalEscalationCycleWasBusy(result)).toBe(true);
  });

  it('runs the state-driven fallback and reconciliation on the first cycle', async () => {
    await runCriticalEscalationCycle({ now: T0 });

    expect(mocks.processPendingEscalations).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileEscalations).toHaveBeenCalledTimes(1);
  });

  it('does not rescan on every cycle', async () => {
    await runCriticalEscalationCycle({ now: T0 });
    await runCriticalEscalationCycle({ now: T0 + 1_000 });
    await runCriticalEscalationCycle({ now: T0 + 2_000 });

    // Job claiming is the normal path; the scans are whole-table and paced.
    expect(mocks.processPendingJobsByType).toHaveBeenCalledTimes(3);
    expect(mocks.processPendingEscalations).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileEscalations).toHaveBeenCalledTimes(1);
  });

  it('rescans once its interval has passed', async () => {
    await runCriticalEscalationCycle({ now: T0 });
    await runCriticalEscalationCycle({ now: T0 + 15_000 });

    expect(mocks.processPendingEscalations).toHaveBeenCalledTimes(2);
    // Reconciliation is on a longer cadence than the fallback scan.
    expect(mocks.reconcileEscalations).toHaveBeenCalledTimes(1);

    await runCriticalEscalationCycle({ now: T0 + 60_000 });
    expect(mocks.reconcileEscalations).toHaveBeenCalledTimes(2);
  });

  it('counts a recovery repair as work', async () => {
    mocks.reconcileEscalations.mockResolvedValue({ ...noRepairs(), dueJobsRecreated: 2 });

    const result = await runCriticalEscalationCycle({ now: T0 });

    expect(result.repairs).toBe(2);
    expect(criticalEscalationCycleWasBusy(result)).toBe(true);
  });

  it('reports an idle cycle as not busy', async () => {
    const result = await runCriticalEscalationCycle({ now: T0 });

    expect(criticalEscalationCycleWasBusy(result)).toBe(false);
  });

  it('keeps running the scans when job claiming fails', async () => {
    mocks.processPendingJobsByType.mockRejectedValue(new Error('queue unavailable'));

    const result = await runCriticalEscalationCycle({ now: T0 });

    expect(result.jobsClaimed).toBe(0);
    // A queue failure must not also stop state-driven recovery.
    expect(mocks.processPendingEscalations).toHaveBeenCalled();
    expect(mocks.reconcileEscalations).toHaveBeenCalled();
  });

  it('never throws, whichever stage fails', async () => {
    mocks.processPendingJobsByType.mockRejectedValue(new Error('queue down'));
    mocks.processPendingEscalations.mockRejectedValue(new Error('scan down'));
    mocks.reconcileEscalations.mockRejectedValue(new Error('recovery down'));

    // The worker loop paces itself off this result; throwing would stall it.
    await expect(runCriticalEscalationCycle({ now: T0 })).resolves.toMatchObject({
      jobsClaimed: 0,
      fallbackProcessed: 0,
      reconciled: false,
    });
  });
});

describe('the wake hint', () => {
  it('is consumed once', () => {
    notifyEscalationWorkPending();

    expect(consumeEscalationWakeRequest()).toBe(true);
    expect(consumeEscalationWakeRequest()).toBe(false);
  });

  it('is absent by default', () => {
    expect(consumeEscalationWakeRequest()).toBe(false);
  });
});
