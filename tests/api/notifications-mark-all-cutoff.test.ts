import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { PATCH } from '@/app/api/notifications/route';
import prisma from '@/lib/prisma';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    inAppNotification: { updateMany: vi.fn() },
  },
}));

function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  );
}

describe('PATCH /api/notifications mark-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(prisma.inAppNotification.updateMany).mockResolvedValue({ count: 1 });
  });

  it('only marks alerts created up to the cutoff a queued offline mark-all carries', async () => {
    const readUpTo = '2026-11-20T10:00:00.000Z';
    const res = await patch({ markAllAsRead: true, readUpTo });

    expect(res.status).toBe(200);
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', readAt: null, createdAt: { lte: new Date(readUpTo) } },
      })
    );
  });

  it('still marks everything unread when there is no cutoff', async () => {
    await patch({ markAllAsRead: true });

    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', readAt: null } })
    );
  });

  it('rejects a cutoff that is not a timestamp', async () => {
    const res = await patch({ markAllAsRead: true, readUpTo: 'yesterday' });

    expect(res.status).toBe(400);
    expect(prisma.inAppNotification.updateMany).not.toHaveBeenCalled();
  });
});
