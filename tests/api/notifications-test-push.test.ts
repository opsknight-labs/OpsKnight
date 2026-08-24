import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/notifications/test-push/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { sendPush } from '@/lib/push';

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
    rateLimit: {
      upsert: vi.fn().mockResolvedValue({ count: 1, resetAt: new Date(Date.now() + 60000) }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock('@/lib/push', () => ({
  sendPush: vi.fn(),
}));

describe('API Route - Notifications Test Push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
  });

  it('returns 404 when user is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(404);
  });

  it('returns 200 when push succeeds', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', name: 'Test User' } as any);
    vi.mocked(sendPush).mockResolvedValue({ success: true });

    const res = await POST();

    expect(res.status).toBe(200);
  });
});
