import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/jobs/queue', () => ({
  processPendingJobs: vi.fn(),
}));

// The critical lanes have their own tests. Here they are stubbed so this file
// tests only the worker loop's pacing and shutdown, without reaching a database.
vi.mock('@/lib/escalation/worker', () => ({
  runCriticalEscalationCycle: vi.fn(),
  criticalEscalationCycleWasBusy: vi.fn(() => false),
  consumeEscalationWakeRequest: vi.fn(() => false),
}));

vi.mock('@/lib/notification-recovery', () => ({
  runCriticalNotificationCycle: vi.fn(),
  criticalNotificationCycleWasBusy: vi.fn(() => false),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { processPendingJobs } from '@/lib/jobs/queue';
import {
  consumeEscalationWakeRequest,
  criticalEscalationCycleWasBusy,
  runCriticalEscalationCycle,
} from '@/lib/escalation/worker';
import {
  criticalNotificationCycleWasBusy,
  runCriticalNotificationCycle,
} from '@/lib/notification-recovery';
import {
  getJobWorkerConfig,
  getJobWorkerStatus,
  startJobWorker,
  stopJobWorker,
} from '@/lib/job-worker';

type WorkerResult = { processed: number; failed: number; total: number };

function testEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...values };
}

describe('dedicated job worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(processPendingJobs).mockResolvedValue({ processed: 0, failed: 0, total: 0 });
    vi.mocked(runCriticalEscalationCycle).mockResolvedValue({
      jobsClaimed: 0,
      jobsProcessed: 0,
      jobsFailed: 0,
      fallbackProcessed: 0,
      reconciled: false,
      repairs: 0,
      errors: [],
    });
    vi.mocked(runCriticalNotificationCycle).mockResolvedValue({
      centralProcessed: 0,
      centralSucceeded: 0,
      centralFailed: 0,
      legacyRetried: 0,
      legacySucceeded: 0,
      scannedCentral: false,
      scannedLegacy: false,
      errors: [],
    });
    vi.mocked(criticalEscalationCycleWasBusy).mockReturnValue(false);
    vi.mocked(criticalNotificationCycleWasBusy).mockReturnValue(false);
    vi.mocked(consumeEscalationWakeRequest).mockReturnValue(false);

    delete process.env.OPSKNIGHT_WORKER_BATCH_SIZE;
    delete process.env.OPSKNIGHT_WORKER_CONCURRENCY;
    delete process.env.OPSKNIGHT_WORKER_IDLE_POLL_MS;
    delete process.env.OPSKNIGHT_WORKER_BUSY_POLL_MS;
  });

  afterEach(async () => {
    await stopJobWorker();
    vi.useRealTimers();
  });

  it('uses conservative bounded defaults', () => {
    expect(getJobWorkerConfig(testEnv())).toEqual({
      batchSize: 100,
      concurrency: 15,
      idlePollMs: 1000,
      busyPollMs: 100,
    });
  });

  it('rejects unsafe or inconsistent configuration', () => {
    expect(() => getJobWorkerConfig(testEnv({ OPSKNIGHT_WORKER_CONCURRENCY: '51' }))).toThrow(
      /OPSKNIGHT_WORKER_CONCURRENCY/
    );

    expect(() =>
      getJobWorkerConfig(
        testEnv({
          OPSKNIGHT_WORKER_BATCH_SIZE: '10',
          OPSKNIGHT_WORKER_CONCURRENCY: '11',
        })
      )
    ).toThrow(/cannot exceed/);
  });

  it('starts immediately and processes the durable queue with existing queue defaults', async () => {
    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);

    expect(processPendingJobs).toHaveBeenCalledTimes(1);
    expect(processPendingJobs).toHaveBeenCalledWith(100, 15);
    expect(getJobWorkerStatus().running).toBe(true);
  });

  it('runs both critical lanes on every replica, ahead of the general queue', async () => {
    const order: string[] = [];
    vi.mocked(runCriticalEscalationCycle).mockImplementation(async () => {
      order.push('escalation');
      return {
        jobsClaimed: 0,
        jobsProcessed: 0,
        jobsFailed: 0,
        fallbackProcessed: 0,
        reconciled: false,
        repairs: 0,
        errors: [],
      };
    });
    vi.mocked(runCriticalNotificationCycle).mockImplementation(async () => {
      order.push('notifications');
      return {
        centralProcessed: 0,
        centralSucceeded: 0,
        centralFailed: 0,
        legacyRetried: 0,
        legacySucceeded: 0,
        scannedCentral: false,
        scannedLegacy: false,
        errors: [],
      };
    });
    vi.mocked(processPendingJobs).mockImplementation(async () => {
      order.push('queue');
      return { processed: 0, failed: 0, total: 0 };
    });

    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);

    // Paging work never queues behind lower-consequence jobs, and neither lane
    // depends on the maintenance scheduler's lease.
    expect(order).toEqual(['escalation', 'notifications', 'queue']);
  });

  it('polls again promptly when only a critical lane found work', async () => {
    vi.mocked(criticalNotificationCycleWasBusy).mockReturnValue(true);

    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    // The busy interval, not the idle one: a recovered page should not wait a
    // full idle poll for the next cycle.
    await vi.advanceTimersByTimeAsync(100);
    expect(processPendingJobs).toHaveBeenCalledTimes(2);
  });

  it('reports partial critical-lane failure as degraded worker health', async () => {
    vi.mocked(runCriticalNotificationCycle).mockResolvedValue({
      centralProcessed: 0,
      centralSucceeded: 0,
      centralFailed: 0,
      legacyRetried: 0,
      legacySucceeded: 0,
      scannedCentral: true,
      scannedLegacy: true,
      errors: ['central queue: database unavailable'],
    });

    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);

    expect(getJobWorkerStatus()).toMatchObject({
      lastSuccessAt: null,
      lastError: 'central queue: database unavailable',
    });
  });

  it('clears degraded health only after every critical lane succeeds', async () => {
    vi.mocked(runCriticalEscalationCycle)
      .mockResolvedValueOnce({
        jobsClaimed: 0,
        jobsProcessed: 0,
        jobsFailed: 0,
        fallbackProcessed: 0,
        reconciled: false,
        repairs: 0,
        errors: ['job batch: database unavailable'],
      })
      .mockResolvedValue({
        jobsClaimed: 0,
        jobsProcessed: 0,
        jobsFailed: 0,
        fallbackProcessed: 0,
        reconciled: false,
        repairs: 0,
        errors: [],
      });

    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(getJobWorkerStatus().lastError).toContain('database unavailable');

    await vi.advanceTimersByTimeAsync(1_250);
    expect(getJobWorkerStatus().lastError).toBeNull();
    expect(getJobWorkerStatus().lastSuccessAt).toBeInstanceOf(Date);
  });

  it('does not overlap queue batches within a worker process', async () => {
    let finishFirst!: (value: WorkerResult) => void;
    vi.mocked(processPendingJobs).mockImplementationOnce(
      () =>
        new Promise<WorkerResult>(resolve => {
          finishFirst = resolve;
        })
    );

    startJobWorker();

    // Let the worker reach its first unresolved batch. The critical lanes run
    // ahead of the queue, so this has to flush their microtasks too; it still
    // does not wait for the batch itself, which stays pending.
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    // A long clock advance must not start another batch while the first promise
    // is still in flight.
    await vi.advanceTimersByTimeAsync(5000);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    finishFirst({ processed: 0, failed: 0, total: 0 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it('waits for an in-flight batch during graceful shutdown and does not claim again', async () => {
    let finishFirst!: (value: WorkerResult) => void;
    vi.mocked(processPendingJobs).mockImplementationOnce(
      () =>
        new Promise<WorkerResult>(resolve => {
          finishFirst = resolve;
        })
    );

    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    let shutdownCompleted = false;
    const shutdown = stopJobWorker().then(() => {
      shutdownCompleted = true;
    });
    await Promise.resolve();

    expect(shutdownCompleted).toBe(false);
    expect(getJobWorkerStatus().running).toBe(false);

    finishFirst({ processed: 1, failed: 0, total: 1 });
    await shutdown;
    expect(shutdownCompleted).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);
  });

  it('backs off and retries after a queue processor failure', async () => {
    vi.mocked(processPendingJobs)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ processed: 0, failed: 0, total: 0 });

    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    // Idle retry jitter is bounded to less than 25%, so 1.25s is enough to
    // observe exactly one retry without reaching the following idle poll.
    await vi.advanceTimersByTimeAsync(1250);
    expect(processPendingJobs).toHaveBeenCalledTimes(2);
  });

  it('stops claiming new batches after graceful shutdown', async () => {
    startJobWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    await stopJobWorker();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(processPendingJobs).toHaveBeenCalledTimes(1);
    expect(getJobWorkerStatus().running).toBe(false);
  });
});
