import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/notifications/stream/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    inAppNotification: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('API Route - Notifications Stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const req = new NextRequest(new URL('http://localhost:3000/api/notifications/stream'));
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns SSE stream for authenticated users', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      timeZone: 'UTC',
    } as never);
    vi.mocked(prisma.inAppNotification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.inAppNotification.count).mockResolvedValue(0);
    vi.mocked(prisma.inAppNotification.aggregate)
      .mockResolvedValueOnce({ _max: { createdAt: null, id: null } } as never)
      .mockResolvedValue({
        _max: { createdAt: new Date('2026-09-05T00:00:00.000Z'), id: 'notification-1' },
      } as never);

    const req = new NextRequest(new URL('http://localhost:3000/api/notifications/stream'), {
      signal: controller.signal,
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    await vi.advanceTimersByTimeAsync(5000);

    expect(vi.mocked(prisma.inAppNotification.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 8,
        select: expect.objectContaining({
          id: true,
          title: true,
          createdAt: true,
        }),
      })
    );

    controller.abort();
    vi.useRealTimers();
  });
});
