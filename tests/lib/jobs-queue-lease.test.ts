import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processEventSideEffect: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    backgroundJob: {
      updateMany: mocks.updateMany,
      update: mocks.update,
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock('@/lib/event-side-effects', () => ({
  processEventSideEffect: mocks.processEventSideEffect,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { processJob } from '@/lib/jobs/queue';

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
      where: { id: 'job-1', status: 'PROCESSING' },
      data: { startedAt: expect.any(Date) },
    });

    finishEffect();
    await expect(processing).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
