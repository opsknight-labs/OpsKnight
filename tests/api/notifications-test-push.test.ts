import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/notifications/test-push/route';
import prisma from '@/lib/prisma';
import { getPushConfig } from '@/lib/notification-providers';
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
    userDevice: {
      count: vi.fn(),
    },
    rateLimit: {
      upsert: vi.fn().mockResolvedValue({ count: 1, resetAt: new Date(Date.now() + 60000) }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getPushConfig: vi.fn(),
}));

vi.mock('@/lib/push', () => ({
  sendPush: vi.fn(),
}));

function mockCurrentUser() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'user-1',
    name: 'Test User',
  } as never);
}

describe('API Route - Notifications Test Push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: 'public-key',
      vapidPrivateKey: 'private-key',
    });
    vi.mocked(prisma.userDevice.count).mockResolvedValue(1);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns 404 when user is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('returns non-retryable validation when push provider is not configured', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(getPushConfig).mockResolvedValue({ enabled: false, provider: null });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.retryable).toBe(false);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('returns non-retryable validation when no web subscription exists', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.count).mockResolvedValue(0);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.retryable).toBe(false);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('returns retryable provider unavailable when delivery fails but subscription remains', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.count).mockResolvedValue(1);
    vi.mocked(sendPush).mockResolvedValue({ success: false, error: 'provider unavailable' });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('NOTIFICATION_PROVIDER_UNAVAILABLE');
    expect(body.retryable).toBe(true);
  });

  it('returns non-retryable validation when a failed send removes the expired subscription', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    vi.mocked(sendPush).mockResolvedValue({ success: false, error: 'subscription expired' });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.retryable).toBe(false);
  });

  it('returns 200 when push succeeds', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(sendPush).mockResolvedValue({ success: true });

    const res = await POST();

    expect(res.status).toBe(200);
  });
});
