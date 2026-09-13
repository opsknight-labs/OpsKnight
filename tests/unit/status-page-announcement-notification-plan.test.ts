import { describe, expect, it } from 'vitest';
import { deriveAnnouncementNotificationPlan } from '@/lib/status-pages/announcement-notification-plan';

const publishAt = new Date('2026-09-15T10:00:00.000Z');
const startDate = new Date('2026-09-15T12:00:00.000Z');

describe('deriveAnnouncementNotificationPlan', () => {
  it('schedules ON_PUBLISH at publishAt', () => {
    expect(
      deriveAnnouncementNotificationPlan({
        isActive: true,
        notificationTiming: 'ON_PUBLISH',
        publishAt,
        startDate,
      })
    ).toEqual({ shouldNotify: true, scheduledAt: publishAt });
  });

  it('schedules AT_START at startDate', () => {
    expect(
      deriveAnnouncementNotificationPlan({
        isActive: true,
        notificationTiming: 'AT_START',
        publishAt,
        startDate,
      })
    ).toEqual({ shouldNotify: true, scheduledAt: startDate });
  });

  it('does not schedule NONE', () => {
    expect(
      deriveAnnouncementNotificationPlan({
        isActive: true,
        notificationTiming: 'NONE',
        publishAt,
        startDate,
      })
    ).toEqual({ shouldNotify: false, scheduledAt: null });
  });

  it('does not schedule inactive announcements regardless of timing', () => {
    expect(
      deriveAnnouncementNotificationPlan({
        isActive: false,
        notificationTiming: 'AT_START',
        publishAt,
        startDate,
      })
    ).toEqual({ shouldNotify: false, scheduledAt: null });
  });
});
