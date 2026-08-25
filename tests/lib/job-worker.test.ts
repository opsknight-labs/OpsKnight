import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/jobs/queue', () => ({
  processPendingJobs: vi.fn(),
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

  it('does not overlap queue batches within a worker process', async () => {
    let finishFirst!: (value: WorkerResult) => void;
    vi.mocked(processPendingJobs).mockImplementationOnce(
      () =>
        new Promise<WorkerResult>(resolve => {
          finishFirst = resolve;
        })
    );

    startJobWorker();

    // Run the zero-delay timer synchronously so the worker enters its first
    // unresolved batch without making the test wait for that batch to finish.
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(processPendingJobs).toHaveBeenCalledTimes(1);

    // A long clock advance must not start another batch while the first promise
    // is still in flight.
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
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
    vi.advanceTimersByTime(0);
    await Promise.resolve();
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
