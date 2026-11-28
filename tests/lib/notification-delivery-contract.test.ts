import { describe, expect, it } from 'vitest';
import {
  defaultNotificationMaxAttempts,
  notificationDedupeKey,
  notificationRetryDelayMs,
  NOTIFICATION_RETRY_POLICY,
} from '@/lib/notification-delivery';

describe('notification delivery contract', () => {
  it('deduplicates the same delivery intent but not a different lifecycle message', () => {
    const base = { incidentId: 'incident-1', userId: 'user-1', channel: 'EMAIL' as const };

    expect(notificationDedupeKey({ ...base, message: 'Incident triggered' })).toBe(
      notificationDedupeKey({ ...base, message: 'Incident triggered' })
    );
    expect(notificationDedupeKey({ ...base, message: 'Incident triggered' })).not.toBe(
      notificationDedupeKey({ ...base, message: 'Incident resolved' })
    );
  });

  it('applies one bounded exponential retry schedule', () => {
    const midpoint = () => 0.5;
    expect(notificationRetryDelayMs(0, NOTIFICATION_RETRY_POLICY, midpoint)).toBe(5_000);
    expect(notificationRetryDelayMs(1, NOTIFICATION_RETRY_POLICY, midpoint)).toBe(10_000);
    expect(notificationRetryDelayMs(2, NOTIFICATION_RETRY_POLICY, midpoint)).toBe(20_000);
    expect(notificationRetryDelayMs(20, NOTIFICATION_RETRY_POLICY, midpoint)).toBe(
      NOTIFICATION_RETRY_POLICY.maximumDelayMs
    );
    expect(notificationRetryDelayMs(1, NOTIFICATION_RETRY_POLICY, () => 0)).toBe(8_000);
    expect(notificationRetryDelayMs(1, NOTIFICATION_RETRY_POLICY, () => 1)).toBe(12_000);
  });

  it('keeps retrying a CRITICAL page for about 15 minutes and leaves other classes at three attempts', () => {
    const attempts = defaultNotificationMaxAttempts('CRITICAL');
    let waitedMs = 0;
    // A failure after attempt n waits notificationRetryDelayMs(n); the last attempt gives up.
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      waitedMs += notificationRetryDelayMs(attempt, NOTIFICATION_RETRY_POLICY, () => 0.5);
    }
    expect(waitedMs).toBeGreaterThanOrEqual(14 * 60_000);
    expect(waitedMs).toBeLessThanOrEqual(16 * 60_000);
    expect(defaultNotificationMaxAttempts('TRANSACTIONAL')).toBe(3);
    expect(defaultNotificationMaxAttempts('BULK')).toBe(3);
    expect(defaultNotificationMaxAttempts()).toBe(NOTIFICATION_RETRY_POLICY.maxAttempts);
  });

  it('does not mutate the shared retry policy', () => {
    expect(Object.isFrozen(NOTIFICATION_RETRY_POLICY)).toBe(true);
  });
});
