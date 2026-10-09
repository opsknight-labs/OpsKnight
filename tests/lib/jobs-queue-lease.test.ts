import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processEventSideEffect: vi.fn(),
  updateMany: vi.fn(),
  queryRaw: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  externalFindUnique: vi.fn(),
  processExternalOperation: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: mocks.queryRaw,
    backgroundJob: {
      updateMany: mocks.updateMany,
      update: mocks.update,
      findUnique: mocks.findUnique,
    },
    externalOperation: { findUnique: mocks.externalFindUnique },
  },
}));

vi.mock('@/lib/event-side-effects', () => ({
  processEventSideEffect: mocks.processEventSideEffect,
}));

vi.mock('@/lib/external-operations', () => ({
  processExternalOperation: mocks.processExternalOperation,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { processJob, processPendingJobsByType } from '@/lib/jobs/queue';

describe('background job processing lease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews startedAt while a long-running job is active and stops after completion', async () => {
    let finishEffect!: () => void;
    mocks.processEventSideEffect.mockImplementation(
      () => new Promise<void>(resolve => (finishEffect = resolve))
    );

    const processing = processJob({
      id: 'job-1',
      claimToken: '00000000-0000-4000-8000-000000000001',
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      attempts: 1,
      maxAttempts: 5,
      payload: {
        task: 'EVENT_SIDE_EFFECT',
        effect: 'TRIGGER_WEBHOOK',
        lane: 'WEBHOOK',
        incidentId: 'inc-1',
        eventOrderAt: '2026-08-30T00:00:00.000Z',
      },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'PROCESSING', attempts: 1, claimToken: '00000000-0000-4000-8000-000000000001' },
      data: { startedAt: expect.any(Date) },
    });

    finishEffect();
    await expect(processing).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reschedules Jira ambiguity but settles Teams ambiguity for explicit reconciliation', async () => {
    const nextAttemptAt = new Date('2026-09-13T12:00:00.000Z');
    mocks.processExternalOperation.mockRejectedValue(new Error('provider unavailable'));
    mocks.externalFindUnique.mockResolvedValueOnce({
      provider: 'JIRA',
      status: 'AMBIGUOUS',
      nextAttemptAt,
      leaseExpiresAt: null,
      lastError: 'retry',
    });
    const job = {
      id: 'job-jira',
      type: 'EXTERNAL_OPERATION' as const,
      status: 'PROCESSING' as const,
      attempts: 1,
      maxAttempts: 8,
      payload: { operationId: 'op-jira' },
    };

    await expect(processJob(job)).resolves.toBe(false);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'job-jira' },
      data: {
        status: 'PENDING',
        scheduledAt: nextAttemptAt,
        startedAt: null,
        claimToken: null,
        attempts: 0,
        error: null,
      },
    });

    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({});
    mocks.processExternalOperation.mockRejectedValue(new Error('ambiguous create'));
    mocks.externalFindUnique.mockResolvedValueOnce({
      provider: 'MICROSOFT_TEAMS',
      status: 'AMBIGUOUS',
      nextAttemptAt,
      leaseExpiresAt: null,
      lastError: 'reconcile',
    });
    await expect(
      processJob({ ...job, id: 'job-teams', payload: { operationId: 'op-teams' } })
    ).resolves.toBe(false);
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      })
    );
  });
});

describe('queued batch lease heartbeat', () => {
  it('renews the waiting batch member while its predecessor is still executing', async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const jobs = ['active', 'waiting'].map(id => ({
      id,
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      attempts: 1,
      maxAttempts: 5,
      payload: {
        task: 'EVENT_SIDE_EFFECT',
        effect: 'TRIGGER_WEBHOOK',
        lane: 'WEBHOOK',
        incidentId: id,
        eventOrderAt: '2026-10-09T00:00:00Z',
      },
    }));
    mocks.queryRaw.mockResolvedValue(jobs);
    let finish!: () => void;
    mocks.processEventSideEffect.mockResolvedValue(undefined).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const batch = processPendingJobsByType('SCHEDULED_TASK', 2, 1);
    try {
      await vi.advanceTimersByTimeAsync(25_000);
      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { OR: jobs.map(job => ({ id: job.id, attempts: 1, status: 'PROCESSING' })) },
        data: { startedAt: expect.any(Date) },
      });
      finish();
      await expect(batch).resolves.toEqual({ processed: 2, failed: 0, total: 2 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (finish) finish();
      await batch;
      vi.useRealTimers();
    }
  });
});
