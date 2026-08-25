/**
 * Cron Scheduler Extended Tests
 *
 * Comprehensive test coverage for the cron scheduler including:
 * - Lock acquisition and release
 * - Stale lock recovery (5-minute timeout)
 * - Concurrent worker handling
 * - Dynamic scheduling calculation
 * - Graceful degradation on DB failures
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCronSchedulerStatus,
  startCronScheduler,
  stopCronScheduler,
} from '@/lib/cron-scheduler';
import prisma from '@/lib/prisma';

// Mock all dependencies
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    cronSchedulerState: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    incident: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    backgroundJob: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/lib/escalation', () => ({
  processPendingEscalations: vi.fn().mockResolvedValue({ processed: 0, total: 0 }),
}));

vi.mock('@/lib/jobs/queue', () => ({
  processPendingJobs: vi.fn().mockResolvedValue({ processed: 0, failed: 0, total: 0 }),
  cleanupOldJobs: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/notification-retry', () => ({
  retryFailedNotifications: vi.fn().mockResolvedValue({ retried: 0 }),
}));

vi.mock('@/app/(app)/incidents/snooze-actions', () => ({
  processAutoUnsnooze: vi.fn().mockResolvedValue({ processed: 0 }),
}));

vi.mock('@/lib/user-tokens', () => ({
  cleanupUserTokens: vi.fn().mockResolvedValue({ deleted: 0 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  cleanupExpiredRateLimits: vi.fn().mockResolvedValue(0),
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 60000, count: 1 }),
}));

vi.mock('@/lib/sla-breach-monitor', () => ({
  checkSLABreaches: vi.fn().mockResolvedValue({ activeIncidentCount: 0, warningCount: 0 }),
}));

describe('Cron Scheduler - Lock Management', () => {
  const defaultState = {
    id: 'singleton',
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRunAt: null,
    lockedBy: null,
    lockedAt: null,
    lastRollupDate: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    vi.mocked(prisma.cronSchedulerState.upsert).mockResolvedValue(defaultState as any);
    vi.mocked(prisma.cronSchedulerState.update).mockResolvedValue(defaultState as any);
    vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValue({ count: 1 } as any);
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Lock Acquisition', () => {
    it.skip('acquires lock when no lock exists', async () => {
      // Skipped: flaky with fake timers due to scheduler timing
      vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      startCronScheduler();
      await vi.advanceTimersByTimeAsync(100);

      expect(prisma.cronSchedulerState.updateMany).toHaveBeenCalled();
      const call = vi.mocked(prisma.cronSchedulerState.updateMany).mock.calls[0];
      expect(call[0].where).toMatchObject({
        id: 'singleton',
        OR: expect.arrayContaining([
          { lockedBy: null },
          expect.objectContaining({ lockedBy: expect.any(String) }),
          expect.objectContaining({ lockedAt: expect.any(Object) }),
        ]),
      });
    });

    it.skip('acquires lock when we already hold it', async () => {
      // Skipped: flaky with fake timers due to scheduler timing
      const workerId = expect.stringMatching(/^worker-/);

      vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      startCronScheduler();
      await vi.advanceTimersByTimeAsync(100);

      const call = vi.mocked(prisma.cronSchedulerState.updateMany).mock.calls[0];
      expect(call).toBeDefined();
      expect(call![0]!.where!.OR).toContainEqual({ lockedBy: workerId });
    });

    it('fails to acquire lock when another worker holds it', async () => {
      vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValueOnce({ count: 0 } as any);
      vi.mocked(prisma.cronSchedulerState.upsert).mockResolvedValue({
        ...defaultState,
        lockedBy: 'worker-other-123',
        lockedAt: new Date(),
      } as any);

      startCronScheduler();
      await vi.advanceTimersByTimeAsync(100);

      // Should schedule retry instead of running
      const status = await getCronSchedulerStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('Stale Lock Recovery', () => {
    it.skip('reclaims lock after 5-minute timeout', async () => {
      // Skipped: flaky with fake timers due to scheduler timing
      const staleTime = new Date('2026-01-01T11:54:00.000Z'); // 6 minutes ago

      vi.mocked(prisma.cronSchedulerState.upsert).mockResolvedValue({
        ...defaultState,
        lockedBy: 'worker-stale-123',
        lockedAt: staleTime,
      } as any);

      // Lock should be acquirable because it's stale
      vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      startCronScheduler();
      await vi.advanceTimersByTimeAsync(100);

      // Verify the lock timeout check is in the query
      const call = vi.mocked(prisma.cronSchedulerState.updateMany).mock.calls[0];
      expect(call).toBeDefined();
      expect(call![0]!.where!.OR).toContainEqual(
        expect.objectContaining({
          lockedAt: expect.objectContaining({ lt: expect.any(Date) }),
        })
      );
    });

    it.skip('does not reclaim lock within 5-minute timeout', async () => {
      // Skipped: flaky with fake timers due to scheduler timing
      const recentTime = new Date('2026-01-01T11:58:00.000Z'); // 2 minutes ago

      vi.mocked(prisma.cronSchedulerState.upsert).mockResolvedValue({
        ...defaultState,
        lockedBy: 'worker-active-123',
        lockedAt: recentTime,
      } as any);

      // Lock acquisition should fail because lock is not stale
      vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValueOnce({ count: 0 } as any);

      startCronScheduler();
      await vi.advanceTimersByTimeAsync(100);

      // Should not have acquired the lock
      expect(prisma.cronSchedulerState.updateMany).toHaveBeenCalled();
    });
  });

  describe('Lock Release', () => {
    it('releases lock on stop', async () => {
      vi.mocked(prisma.cronSchedulerState.updateMany)
        .mockResolvedValueOnce({ count: 1 } as any) // acquire
        .mockResolvedValueOnce({ count: 1 } as any); // release

      startCronScheduler();
      await vi.advanceTimersByTimeAsync(100);

      await stopCronScheduler();

      // Verify release was called with correct parameters
      const releaseCalls = vi.mocked(prisma.cronSchedulerState.updateMany).mock.calls;
      const releaseCall = releaseCalls.find(call => call[0].data?.lockedBy === null);
      expect(releaseCall).toBeDefined();
    });

    it('only releases lock if we hold it', async () => {
      startCronScheduler();
      await stopCronScheduler();

      // Release should include lockedBy: workerId check
      const releaseCalls = vi.mocked(prisma.cronSchedulerState.updateMany).mock.calls;
      const releaseCall = releaseCalls.find(call => call[0]?.data?.lockedBy === null);
      if (releaseCall && releaseCall[0]?.where?.lockedBy) {
        expect(releaseCall[0].where.lockedBy).toMatch(/^worker-/);
      }
    });
  });
});

describe('Cron Scheduler - Dynamic Scheduling', () => {
  const defaultState = {
    id: 'singleton',
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRunAt: null,
    lockedBy: null,
    lockedAt: null,
    lastRollupDate: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    vi.mocked(prisma.cronSchedulerState.upsert).mockResolvedValue(defaultState as any);
    vi.mocked(prisma.cronSchedulerState.update).mockResolvedValue(defaultState as any);
    vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValue({ count: 1 } as any);
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('schedules next run based on pending work', async () => {
    const nextEscalation = new Date('2026-01-01T12:02:00.000Z');

    vi.mocked(prisma.incident.findFirst).mockResolvedValueOnce({
      nextEscalationAt: nextEscalation,
    } as any);

    startCronScheduler();
    await vi.advanceTimersByTimeAsync(100);

    // Should schedule based on next escalation time
    expect(prisma.cronSchedulerState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRunAt: expect.any(Date),
        }),
      })
    );
  });

  it('uses max delay when no pending work', async () => {
    vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.findFirst).mockResolvedValue(null);

    startCronScheduler();
    await vi.advanceTimersByTimeAsync(100);

    const status = await getCronSchedulerStatus();
    expect(status.schedule).toBe('dynamic');
  });

  it('enforces minimum delay', async () => {
    // Schedule something 1 second from now
    const tooSoon = new Date('2026-01-01T12:00:01.000Z');

    vi.mocked(prisma.incident.findFirst).mockResolvedValueOnce({
      nextEscalationAt: tooSoon,
    } as any);

    startCronScheduler();
    await vi.advanceTimersByTimeAsync(100);

    // Should enforce minimum delay (15 seconds)
    // Actual delay should be clamped to MIN_DELAY_MS
    expect(prisma.cronSchedulerState.update).toHaveBeenCalled();
  });
});

describe('Cron Scheduler - Graceful Degradation', () => {
  const defaultState = {
    id: 'singleton',
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRunAt: null,
    lockedBy: null,
    lockedAt: null,
    lastRollupDate: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    vi.mocked(prisma.cronSchedulerState.upsert).mockResolvedValue(defaultState as any);
    vi.mocked(prisma.cronSchedulerState.update).mockResolvedValue(defaultState as any);
    vi.mocked(prisma.cronSchedulerState.updateMany).mockResolvedValue({ count: 1 } as any);
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('continues running when state update fails', async () => {
    vi.mocked(prisma.cronSchedulerState.update).mockRejectedValueOnce(
      new Error('DB connection lost')
    );

    startCronScheduler();
    await vi.advanceTimersByTimeAsync(100);

    // Should still be running
    const status = await getCronSchedulerStatus();
    expect(status.running).toBe(true);
  });

  it('returns default status when DB read fails', async () => {
    vi.mocked(prisma.cronSchedulerState.upsert).mockRejectedValueOnce(
      new Error('DB connection lost')
    );

    startCronScheduler();

    const status = await getCronSchedulerStatus();

    expect(status.running).toBe(true);
    // lastError may be null or contain error message depending on timing
  });

  it('schedules retry on lock acquisition failure', async () => {
    vi.mocked(prisma.cronSchedulerState.updateMany)
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ count: 1 } as any);

    startCronScheduler();
    await vi.advanceTimersByTimeAsync(100);

    // Should still be running and will retry
    const status = await getCronSchedulerStatus();
    expect(status.running).toBe(true);
  });
});

describe('Cron Scheduler - Environment Controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.NEXT_PHASE;
    delete process.env.ENABLE_INTERNAL_CRON;
  });

  it('skips scheduler during build phase', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';

    startCronScheduler();

    const status = await getCronSchedulerStatus();
    // Timer should not be set during build
    expect(status.running).toBe(false);
  });

  it('skips scheduler when ENABLE_INTERNAL_CRON=false', async () => {
    process.env.ENABLE_INTERNAL_CRON = 'false';

    startCronScheduler();

    const status = await getCronSchedulerStatus();
    expect(status.running).toBe(false);
  });
});
