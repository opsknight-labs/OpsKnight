import { describe, expect, it } from 'vitest';
import { deriveAnnouncementLifecycle } from '@/lib/status-pages/announcement-lifecycle';

describe('Centralized Announcement Lifecycle', () => {
  const baseNow = new Date('2026-09-15T12:00:00.000Z');

  it('marks inactive notices as DRAFT', () => {
    const res = deriveAnnouncementLifecycle({
      isActive: false,
      startDate: '2026-09-15T10:00:00.000Z',
      endDate: '2026-09-15T14:00:00.000Z',
      now: baseNow,
    });
    expect(res.status).toBe('DRAFT');
    expect(res.isDraft).toBe(true);
    expect(res.isPubliclyVisible).toBe(false);
  });

  it('marks future start dates as SCHEDULED', () => {
    const res = deriveAnnouncementLifecycle({
      isActive: true,
      startDate: '2026-09-16T10:00:00.000Z',
      endDate: '2026-09-16T12:00:00.000Z',
      now: baseNow,
    });
    expect(res.status).toBe('SCHEDULED');
    expect(res.isScheduled).toBe(true);
    expect(res.isPublished).toBe(true);
    expect(res.isPubliclyVisible).toBe(true);
    expect(res.isPublishedUpcoming).toBe(true);
    expect(res.isScheduledForPublication).toBe(false);
  });

  it('marks future publication dates as SCHEDULED and not publicly visible yet', () => {
    const res = deriveAnnouncementLifecycle({
      isActive: true,
      startDate: '2026-09-15T10:00:00.000Z',
      endDate: '2026-09-15T14:00:00.000Z',
      publishAt: '2026-09-15T13:00:00.000Z',
      now: baseNow,
    });
    expect(res.status).toBe('SCHEDULED');
    expect(res.isScheduled).toBe(true);
    expect(res.isPublished).toBe(false);
    expect(res.isPubliclyVisible).toBe(false);
    expect(res.isScheduledForPublication).toBe(true);
    expect(res.isPublishedUpcoming).toBe(false);
  });

  it('marks past end dates as CONCLUDED', () => {
    const res = deriveAnnouncementLifecycle({
      isActive: true,
      startDate: '2026-09-15T08:00:00.000Z',
      endDate: '2026-09-15T11:00:00.000Z',
      now: baseNow,
    });
    expect(res.status).toBe('CONCLUDED');
    expect(res.isConcluded).toBe(true);
    expect(res.isActive).toBe(false);
  });

  it('marks currently ongoing windows as ACTIVE', () => {
    const res = deriveAnnouncementLifecycle({
      isActive: true,
      startDate: '2026-09-15T10:00:00.000Z',
      endDate: '2026-09-15T14:00:00.000Z',
      now: baseNow,
    });
    expect(res.status).toBe('ACTIVE');
    expect(res.isActive).toBe(true);
    expect(res.isConcluded).toBe(false);
  });

  it('marks open-ended ongoing notices as ACTIVE', () => {
    const res = deriveAnnouncementLifecycle({
      isActive: true,
      startDate: '2026-09-15T10:00:00.000Z',
      endDate: null,
      now: baseNow,
    });
    expect(res.status).toBe('ACTIVE');
    expect(res.isActive).toBe(true);
  });
});
