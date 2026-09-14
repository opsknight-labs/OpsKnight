import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/notifications/test-push/route';
import prisma from '@/lib/prisma';
import { getPushConfig } from '@/lib/notification-providers';
import { getServerSession } from 'next-auth';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';

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
      findFirst: vi.fn(),
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

vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: vi.fn(),
}));

vi.mock('@/lib/web-push-subscription', () => ({
  webPushDeviceKey: vi.fn((endpoint: string) => `key:${endpoint}`),
}));

function mockCurrentUser() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'user-1',
    name: 'Test User',
  } as never);
}

function makeRequest(body?: Record<string, unknown> | null): Request {
  const payload = body === undefined ? { endpoint: 'https://example.com/push/default' } : body;
  return new Request('http://localhost/api/notifications/test-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload !== null ? JSON.stringify(payload) : undefined,
  });
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
    vi.mocked(prisma.userDevice.findFirst).mockResolvedValue({
      id: 'dev-1',
      deviceId: 'key:https://example.com/push/default',
    } as never);
    vi.mocked(enqueueCentralNotification).mockResolvedValue({
      id: 'notification_test',
      created: true,
      delivered: true,
    });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns 404 when user is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('returns non-retryable validation when push provider is not configured', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(getPushConfig).mockResolvedValue({ enabled: false, provider: null });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.retryable).toBe(false);
    expect(enqueueCentralNotification).not.toHaveBeenCalled();
  });

  it('returns non-retryable validation when no web subscription exists', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.count).mockResolvedValue(0);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.retryable).toBe(false);
    expect(enqueueCentralNotification).not.toHaveBeenCalled();
  });

  it('returns retryable provider unavailable when delivery fails but subscription remains', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.count).mockResolvedValue(1);
    vi.mocked(enqueueCentralNotification).mockResolvedValue({
      id: 'notification_test',
      created: true,
      delivered: false,
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('NOTIFICATION_PROVIDER_UNAVAILABLE');
    expect(body.retryable).toBe(true);
  });

  it('returns non-retryable validation when a failed send removes the expired subscription', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.count).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    vi.mocked(enqueueCentralNotification).mockResolvedValue({
      id: 'notification_test',
      created: true,
      delivered: false,
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.retryable).toBe(false);
  });

  it('returns 400 when no endpoint is provided', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();

    const res = await POST(makeRequest(null));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(enqueueCentralNotification).not.toHaveBeenCalled();
  });

  it('dispatches to the specific device when a valid endpoint is provided', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.findFirst).mockResolvedValue({
      id: 'dev-1',
      deviceId: 'key:https://example.com/push/abc',
    } as never);

    const res = await POST(makeRequest({ endpoint: 'https://example.com/push/abc' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.targetedDevice).toBe('key:https://example.com/push/abc');
    expect(enqueueCentralNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        trafficClass: 'TRANSACTIONAL',
        priority: 1,
        payload: expect.objectContaining({
          targetDeviceId: 'key:https://example.com/push/abc',
        }),
      })
    );
  });

  it('returns 404 when supplied endpoint does not belong to the user', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();
    vi.mocked(prisma.userDevice.findFirst).mockResolvedValue(null);

    const res = await POST(makeRequest({ endpoint: 'https://example.com/push/unknown' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(enqueueCentralNotification).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_JSON when body JSON is unparseable', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    mockCurrentUser();

    const req = new Request('http://localhost/api/notifications/test-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_JSON');
    expect(enqueueCentralNotification).not.toHaveBeenCalled();
  });
});
