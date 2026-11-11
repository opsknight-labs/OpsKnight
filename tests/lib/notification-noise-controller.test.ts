import { describe, expect, it, vi } from 'vitest';
import {
  BUNDLE_WINDOW_MS,
  decideBundle,
  decideNotificationNoise,
  isBundleCandidate,
  notificationNoiseDecision,
} from '@/lib/notification-noise-controller';

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

  describe('low-urgency bundling', () => {
    const now = new Date('2026-11-12T10:00:00.000Z');
    const page = {
      ...base,
      eventType: 'incident-triggered',
      trafficClass: 'CRITICAL' as const,
      priority: 1,
      bundle: true,
      channel: 'SMS' as const,
    };

    it('is off unless the caller asks for it', () => {
      expect(isBundleCandidate({ ...page, bundle: undefined })).toBe(false);
      expect(isBundleCandidate(page)).toBe(true);
    });

    it('never bundles a responder-critical, transactional or storm-child notification', () => {
      expect(isBundleCandidate({ ...page, priority: 0 })).toBe(false);
      expect(isBundleCandidate({ ...page, trafficClass: 'TRANSACTIONAL' })).toBe(false);
      expect(isBundleCandidate({ ...page, rollUpParentId: 'parent-1' })).toBe(false);
    });

    it('delivers the first page at once, holds the next, suppresses only behind a held one', () => {
      expect(decideBundle(null, now)).toEqual({ action: 'DELIVER' });
      // The earlier page already went out: this one is held and stands for the bundle.
      expect(decideBundle(new Date(now.getTime() - 60_000), now)).toEqual({
        action: 'BUNDLE',
        until: new Date(now.getTime() + BUNDLE_WINDOW_MS),
      });
      // A held notification is still waiting: it covers this page.
      expect(decideBundle(new Date(now.getTime() + 60_000), now)).toEqual({
        action: 'SUPPRESS',
        reason: 'Bundled with other low-urgency pages',
      });
    });

    it('reads the store only for a bundle candidate', async () => {
      const findFirst = vi.fn().mockResolvedValue({ scheduledAt: new Date(now.getTime() - 1) });
      const count = vi.fn();
      const store = { notification: { findFirst, count } } as never;

      await expect(
        notificationNoiseDecision(store, { ...page, priority: 0 }, now)
      ).resolves.toEqual({ action: 'DELIVER' });
      await expect(
        notificationNoiseDecision(store, { ...page, bundle: false }, now)
      ).resolves.toEqual({ action: 'DELIVER' });
      expect(findFirst).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();

      await expect(notificationNoiseDecision(store, page, now)).resolves.toMatchObject({
        action: 'BUNDLE',
      });
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst.mock.calls[0][0].where).toMatchObject({
        userId: 'responder-1',
        channel: 'SMS',
        status: { not: 'SKIPPED' },
        createdAt: { gte: new Date(now.getTime() - BUNDLE_WINDOW_MS) },
      });
    });
  });
});
