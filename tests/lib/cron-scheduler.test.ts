import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCronSchedulerStatus,
  startCronScheduler,
  stopCronScheduler,
} from '@/lib/cron-scheduler';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    cronSchedulerState: {
      upsert: vi.fn().mockResolvedValue({
        id: 'singleton',
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        nextRunAt: null,
        lockedBy: null,
        lockedAt: null,
        lastRollupDate: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

describe('cron-scheduler lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('marks scheduler as running after start', async () => {
    startCronScheduler();

    const status = await getCronSchedulerStatus();

    expect(status.running).toBe(true);
    expect(status.schedule).toBe('dynamic');
  });

  it('marks scheduler as stopped after stop', async () => {
    startCronScheduler();
    await stopCronScheduler();

    const status = await getCronSchedulerStatus();

    expect(status.running).toBe(false);
  });
});
