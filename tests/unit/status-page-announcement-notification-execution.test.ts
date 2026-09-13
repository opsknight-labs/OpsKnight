import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAnnouncement: vi.fn(),
  readGeneration: vi.fn(),
  notifySubscribers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    statusPageAnnouncement: { findFirst: mocks.findAnnouncement },
  },
}));

vi.mock('@/lib/status-pages/announcement-notification-generation', () => ({
  readAnnouncementNotificationGeneration: mocks.readGeneration,
}));

vi.mock('@/lib/status-page-notifications', () => ({
  notifyStatusPageSubscribersAnnouncement: mocks.notifySubscribers,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeAnnouncementNotificationFanout } from '@/lib/status-pages/announcement-notification-execution';

describe('announcement fanout execution eligibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));
    mocks.findAnnouncement.mockReset();
    mocks.readGeneration.mockReset();
    mocks.notifySubscribers.mockReset();
    mocks.readGeneration.mockResolvedValue(7);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns NOT_DUE with the canonical retry time instead of treating an early claim as stale', async () => {
    mocks.findAnnouncement.mockResolvedValue({
      id: 'announcement-1',
      statusPageId: 'page-1',
      isActive: true,
      notificationTiming: 'AT_START',
      publishAt: new Date('2026-09-15T09:00:00.000Z'),
      startDate: new Date('2026-09-15T10:00:05.000Z'),
    });

    const result = await executeAnnouncementNotificationFanout(
      'announcement-1',
      'page-1',
      7,
      'UNDELIVERED_ONLY'
    );

    expect(result).toEqual({
      status: 'NOT_DUE',
      retryAt: new Date('2026-09-15T10:00:05.000Z'),
    });
    expect(mocks.notifySubscribers).not.toHaveBeenCalled();
  });

  it('uses publication eligibility as the retry time when AT_START is earlier than publishAt', async () => {
    mocks.findAnnouncement.mockResolvedValue({
      id: 'announcement-1',
      statusPageId: 'page-1',
      isActive: true,
      notificationTiming: 'AT_START',
      publishAt: new Date('2026-09-15T10:00:10.000Z'),
      startDate: new Date('2026-09-15T09:30:00.000Z'),
    });

    const result = await executeAnnouncementNotificationFanout(
      'announcement-1',
      'page-1',
      7
    );

    expect(result).toEqual({
      status: 'NOT_DUE',
      retryAt: new Date('2026-09-15T10:00:10.000Z'),
    });
  });

  it('returns STALE for a superseded generation', async () => {
    mocks.findAnnouncement.mockResolvedValue({
      id: 'announcement-1',
      statusPageId: 'page-1',
      isActive: true,
      notificationTiming: 'ON_PUBLISH',
      publishAt: new Date('2026-09-15T09:00:00.000Z'),
      startDate: new Date('2026-09-15T11:00:00.000Z'),
    });
    mocks.readGeneration.mockResolvedValue(8);

    const result = await executeAnnouncementNotificationFanout(
      'announcement-1',
      'page-1',
      7
    );

    expect(result).toEqual({
      status: 'STALE',
      reason: 'Announcement generation was superseded',
    });
    expect(mocks.notifySubscribers).not.toHaveBeenCalled();
  });

  it('executes a due current generation and preserves the replacement delivery mode', async () => {
    mocks.findAnnouncement.mockResolvedValue({
      id: 'announcement-1',
      statusPageId: 'page-1',
      isActive: true,
      notificationTiming: 'ON_PUBLISH',
      publishAt: new Date('2026-09-15T09:00:00.000Z'),
      startDate: new Date('2026-09-15T11:00:00.000Z'),
    });
    mocks.notifySubscribers.mockResolvedValue({ sent: 6_000, failed: 0 });

    const result = await executeAnnouncementNotificationFanout(
      'announcement-1',
      'page-1',
      7,
      'UNDELIVERED_ONLY'
    );

    expect(result).toEqual({ status: 'EXECUTED', sent: 6_000, failed: 0 });
    expect(mocks.notifySubscribers).toHaveBeenCalledWith(
      'announcement-1',
      'page-1',
      7,
      'UNDELIVERED_ONLY'
    );
  });
});
