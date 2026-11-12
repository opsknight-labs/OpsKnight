import { describe, expect, it } from 'vitest';
import { decideNotificationNoise } from '@/lib/notification-noise-controller';

const base = {
  recipientId: 'responder-1',
  sourceType: 'SERVICE',
  sourceId: 'payments',
  eventType: 'incident-updated',
  trafficClass: 'BULK' as const,
  priority: 5,
};

describe('notification noise controller', () => {
  it.each(['CRITICAL', 'TRANSACTIONAL'] as const)(
    'never suppresses %s responder traffic',
    trafficClass => {
      expect(decideNotificationNoise({ ...base, trafficClass }, 10_000)).toEqual({
        action: 'DELIVER',
      });
    }
  );

  it('deterministically defers, groups, then suppresses informational storms', () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    expect(decideNotificationNoise(base, 5, now)).toEqual({
      action: 'DEFER',
      until: new Date('2026-09-20T00:01:00.000Z'),
    });
    expect(decideNotificationNoise(base, 15, now)).toEqual({
      action: 'GROUP',
      groupKey: 'responder-1:SERVICE:payments:incident-updated',
    });
    expect(decideNotificationNoise(base, 10_000, now)).toEqual({
      action: 'SUPPRESS',
      reason: 'Grouped under responder-1:SERVICE:payments:incident-updated',
    });
  });

  it.each(['CRITICAL', 'TRANSACTIONAL', 'BULK'] as const)(
    'rolls a storm child up under its parent whatever the traffic class (%s)',
    trafficClass => {
      const child = { ...base, trafficClass, rollUpParentId: 'parent-1' };
      // Nothing posted for the parent recently: one grouped post for the storm.
      expect(decideNotificationNoise(child, 0)).toEqual({
        action: 'GROUP',
        groupKey: 'responder-1:SERVICE:payments:incident-updated',
      });
      // The parent (or an earlier child) already posted: the child is suppressed.
      expect(decideNotificationNoise(child, 1)).toEqual({
        action: 'SUPPRESS',
        reason: 'Rolled up under parent incident parent-1',
      });
    }
  );
});
