import { describe, expect, it } from 'vitest';
import {
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
    expect(notificationRetryDelayMs(0)).toBe(5_000);
    expect(notificationRetryDelayMs(1)).toBe(10_000);
    expect(notificationRetryDelayMs(2)).toBe(20_000);
    expect(notificationRetryDelayMs(20)).toBe(NOTIFICATION_RETRY_POLICY.maximumDelayMs);
  });

  it('does not mutate the shared retry policy', () => {
    expect(Object.isFrozen(NOTIFICATION_RETRY_POLICY)).toBe(true);
  });
});
