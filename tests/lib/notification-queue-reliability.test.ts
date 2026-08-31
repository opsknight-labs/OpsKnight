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

    // All delivery paths share the contract's ten-second delay after attempt one,
    // followed by the restarted one-second flush timer.
    // The retry scheduler adds up to 20% jitter to avoid synchronized retries.
    await vi.advanceTimersByTimeAsync(13_000);
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

  it('does not retry a terminally skipped delivery', async () => {
    sendNotification.mockResolvedValue({
      success: false,
      skipped: true,
      terminal: true,
      error: 'No registered device',
    });
    queueNotification('incident-3', 'user-3', 'PUSH', 'Incident acknowledged', 2, 'acknowledged');

    await vi.advanceTimersByTimeAsync(20_000);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      'incident-3',
      'user-3',
      'PUSH',
      'Incident acknowledged',
      undefined,
      'acknowledged'
    );
  });

  it('does not deduplicate a permanent failure after its configuration is corrected', async () => {
    sendNotification.mockResolvedValue({
      success: false,
      terminal: true,
      error: 'No webhook URL configured for service',
    });
    queueNotification('incident-4', 'user-4', 'WEBHOOK', 'Incident opened');

    await vi.advanceTimersByTimeAsync(20_000);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(queueNotification('incident-4', 'user-4', 'WEBHOOK', 'Incident opened')).toBe(true);
  });
});
