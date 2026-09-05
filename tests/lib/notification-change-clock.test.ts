import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '@/lib/prisma';
import {
  clearNotificationChangeClock,
  getNotificationUserChangeVersion,
} from '@/lib/notification-change-clock';

vi.mock('@/lib/prisma', () => ({
  default: { inAppNotification: { findMany: vi.fn() } },
}));

describe('notification change feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNotificationChangeClock(new Date('2026-09-05T00:00:30.000Z').getTime());
  });

  it('coalesces replica polls and changes only affected user versions', async () => {
    vi.mocked(prisma.inAppNotification.findMany).mockResolvedValue([
      {
        userId: 'user-a',
        id: 'notification-1',
        createdAt: new Date('2026-09-05T00:00:10.000Z'),
      },
    ] as never);

    const [userA, userB] = await Promise.all([
      getNotificationUserChangeVersion('user-a'),
      getNotificationUserChangeVersion('user-b'),
    ]);

    expect(userA).toBe(1);
    expect(userB).toBe(0);
    expect(prisma.inAppNotification.findMany).toHaveBeenCalledTimes(1);
  });

  it('uses the composite cursor and a bounded batch', async () => {
    vi.mocked(prisma.inAppNotification.findMany).mockResolvedValue([]);

    await getNotificationUserChangeVersion('user-a');

    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2_000,
        select: { userId: true, createdAt: true, id: true },
      })
    );
  });

  it('drains full feed pages immediately up to the safety bound', async () => {
    const firstPage = Array.from({ length: 2_000 }, (_, index) => ({
      userId: 'user-a',
      id: `notification-${String(index).padStart(4, '0')}`,
      createdAt: new Date('2026-09-05T00:00:10.000Z'),
    }));
    vi.mocked(prisma.inAppNotification.findMany)
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce([
        {
          userId: 'user-b',
          id: 'notification-next',
          createdAt: new Date('2026-09-05T00:00:11.000Z'),
        },
      ] as never);

    expect(await getNotificationUserChangeVersion('user-b')).toBe(2);
    expect(prisma.inAppNotification.findMany).toHaveBeenCalledTimes(2);
  });
});
