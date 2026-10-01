import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/notifications/history/route';
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
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

describe('GET /api/notifications/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'engineer@example.com' },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-123',
      timeZone: 'UTC',
    } as never);
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notification.count).mockResolvedValue(0);
    vi.mocked(prisma.notification.groupBy).mockResolvedValue([]);
  });

  it('filters by MICROSOFT_TEAMS channel correctly', async () => {
    const req = new NextRequest(
      new URL('http://localhost:3000/api/notifications/history?channel=MICROSOFT_TEAMS')
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-123',
          channel: 'MICROSOFT_TEAMS',
        }),
      })
    );
  });

  it('filters by SLACK channel correctly', async () => {
    const req = new NextRequest(
      new URL('http://localhost:3000/api/notifications/history?channel=SLACK')
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-123',
          channel: 'SLACK',
        }),
      })
    );
  });

  it('ignores invalid channel filter', async () => {
    const req = new NextRequest(
      new URL('http://localhost:3000/api/notifications/history?channel=CARRIER_PIGEON')
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-123',
        },
      })
    );
  });
});
