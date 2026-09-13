import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  executeFanout: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    backgroundJob: {
      update: mocks.update,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/status-pages/announcement-notification-execution', () => ({
  executeAnnouncementNotificationFanout: mocks.executeFanout,
}));

import { processJob } from '@/lib/jobs/queue';

const retryAt = new Date('2026-09-15T10:00:05.000Z');

describe('V2 announcement fanout queue semantics', () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.updateMany.mockReset();
    mocks.findUnique.mockReset();
    mocks.executeFanout.mockReset();
    mocks.update.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('reschedules a current-generation NOT_DUE job without cancelling or consuming failure budget', async () => {
    mocks.executeFanout.mockResolvedValue({ status: 'NOT_DUE', retryAt });

    const result = await processJob({
      id: 'job-v2',
      type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2',
      status: 'PROCESSING_V2',
      attempts: 2,
      maxAttempts: 5,
      payload: {
        announcementId: 'announcement-1',
        statusPageId: 'page-1',
        notificationGeneration: 7,
        deliveryMode: 'UNDELIVERED_ONLY',
      },
    });

    expect(result).toBe(false);
    expect(mocks.executeFanout).toHaveBeenCalledWith(
      'announcement-1',
      'page-1',
      7,
      'UNDELIVERED_ONLY'
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'job-v2' },
      data: {
        status: 'PENDING_V2',
        scheduledAt: retryAt,
        startedAt: null,
        failedAt: null,
        error: null,
      },
    });
    expect(
      mocks.update.mock.calls.some(([call]) => call?.data?.status === 'CANCELLED')
    ).toBe(false);
  });

  it('terminally cancels a stale V2 generation', async () => {
    mocks.executeFanout.mockResolvedValue({
      status: 'STALE',
      reason: 'Announcement generation was superseded',
    });

    const result = await processJob({
      id: 'job-v2',
      type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2',
      status: 'PROCESSING_V2',
      attempts: 2,
      maxAttempts: 5,
      payload: {
        announcementId: 'announcement-1',
        statusPageId: 'page-1',
        notificationGeneration: 7,
        deliveryMode: 'ALL_ELIGIBLE',
      },
    });

    expect(result).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'job-v2' },
      data: {
        status: 'CANCELLED',
        completedAt: expect.any(Date),
        startedAt: null,
        error: 'Announcement generation was superseded',
      },
    });
  });
});
