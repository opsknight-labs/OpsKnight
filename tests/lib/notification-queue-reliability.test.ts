import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.hoisted(() => vi.fn());

vi.mock('@/lib/notifications', () => ({
  sendNotification,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { clearQueue, forceFlush, getQueueStats, queueNotification } from '@/lib/notification-queue';

describe('notification queue delivery reliability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearQueue();
    sendNotification.mockReset();
  });

  afterEach(() => {
    clearQueue();
    vi.useRealTimers();
  });

  it('retries a provider result that reports success=false', async () => {
    sendNotification
      .mockResolvedValueOnce({ success: false, error: 'provider unavailable' })
      .mockResolvedValueOnce({ success: true });

    expect(queueNotification('incident-1', 'user-1', 'EMAIL', 'Incident opened')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(getQueueStats().pending).toBe(0);

    // First retry uses a two-second backoff, then the restarted flush timer.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendNotification).toHaveBeenCalledTimes(2);

    await forceFlush();
    expect(getQueueStats().pending).toBe(0);
  });

  it('does not deduplicate a notification whose delivery failed', async () => {
    sendNotification.mockResolvedValue({ success: false, error: 'provider unavailable' });
    queueNotification('incident-2', 'user-2', 'SMS', 'Incident opened');

    await vi.advanceTimersByTimeAsync(1_000);
    clearQueue();

    expect(queueNotification('incident-2', 'user-2', 'SMS', 'Incident opened')).toBe(true);
  });
});
