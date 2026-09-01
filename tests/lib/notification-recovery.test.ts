import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processCentralNotificationQueue: vi.fn(),
  retryFailedNotifications: vi.fn(),
}));

vi.mock('@/lib/notification-control-plane', () => ({
  processCentralNotificationQueue: mocks.processCentralNotificationQueue,
}));

vi.mock('@/lib/notification-retry', () => ({
  retryFailedNotifications: mocks.retryFailedNotifications,
}));

import {
  criticalNotificationCycleWasBusy,
  resetCriticalNotificationCadence,
  runCriticalNotificationCycle,
} from '@/lib/notification-recovery';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  resetCriticalNotificationCadence();
  mocks.processCentralNotificationQueue.mockResolvedValue({
    processed: 0,
    succeeded: 0,
    failed: 0,
  });
  mocks.retryFailedNotifications.mockResolvedValue({ retried: 0, succeeded: 0, failed: 0 });
});

describe('runCriticalNotificationCycle', () => {
  it('recovers both notification paths on the first cycle', async () => {
    const result = await runCriticalNotificationCycle({ now: T0 });

    expect(mocks.processCentralNotificationQueue).toHaveBeenCalledTimes(1);
    expect(mocks.retryFailedNotifications).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ scannedCentral: true, scannedLegacy: true });
  });

  it('scans the durable queue in seconds, not on the maintenance tick', async () => {
    await runCriticalNotificationCycle({ now: T0 });
    await runCriticalNotificationCycle({ now: T0 + 1_000 });
    await runCriticalNotificationCycle({ now: T0 + 2_000 });

    // A page escalation already committed is picked up within a couple of
    // seconds, rather than waiting on a 15s–2m leader poll.
    expect(mocks.processCentralNotificationQueue).toHaveBeenCalledTimes(2);
  });

  it('sweeps the legacy path on its own slower cadence', async () => {
    await runCriticalNotificationCycle({ now: T0 });
    await runCriticalNotificationCycle({ now: T0 + 2_000 });
    expect(mocks.retryFailedNotifications).toHaveBeenCalledTimes(1);

    // That path has its own backoff and a two-minute pending timeout, so
    // scanning it faster would find nothing new.
    await runCriticalNotificationCycle({ now: T0 + 15_000 });
    expect(mocks.retryFailedNotifications).toHaveBeenCalledTimes(2);
  });

  it('reports a cycle that delivered something as busy', async () => {
    mocks.processCentralNotificationQueue.mockResolvedValue({
      processed: 3,
      succeeded: 3,
      failed: 0,
    });

    const result = await runCriticalNotificationCycle({ now: T0 });

    expect(result).toMatchObject({ centralProcessed: 3, centralSucceeded: 3 });
    expect(criticalNotificationCycleWasBusy(result)).toBe(true);
  });

  it('reports an idle cycle as not busy', async () => {
    const result = await runCriticalNotificationCycle({ now: T0 });

    expect(criticalNotificationCycleWasBusy(result)).toBe(false);
  });

  it('keeps sweeping the legacy path when the durable queue fails', async () => {
    mocks.processCentralNotificationQueue.mockRejectedValue(new Error('control plane down'));

    await runCriticalNotificationCycle({ now: T0 });

    // One path failing must not take the other down with it.
    expect(mocks.retryFailedNotifications).toHaveBeenCalledTimes(1);
  });

  it('never throws, whichever path fails', async () => {
    mocks.processCentralNotificationQueue.mockRejectedValue(new Error('control plane down'));
    mocks.retryFailedNotifications.mockRejectedValue(new Error('sweeper down'));

    // The worker loop paces itself off this result; throwing would stall it.
    await expect(runCriticalNotificationCycle({ now: T0 })).resolves.toMatchObject({
      centralProcessed: 0,
      legacyRetried: 0,
    });
  });

  it('advances its cadence even when a scan fails, so a failure cannot hot-loop', async () => {
    mocks.processCentralNotificationQueue.mockRejectedValue(new Error('control plane down'));

    await runCriticalNotificationCycle({ now: T0 });
    await runCriticalNotificationCycle({ now: T0 + 500 });

    expect(mocks.processCentralNotificationQueue).toHaveBeenCalledTimes(1);
  });
});
