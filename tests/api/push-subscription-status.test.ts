import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/user/push-subscription/status/route';
import prisma from '@/lib/prisma';
import { getPushConfig } from '@/lib/notification-providers';
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
    userDevice: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getPushConfig: vi.fn(),
}));

vi.mock('@/lib/web-push-subscription', () => ({
  webPushDeviceKey: vi.fn((endpoint: string) => `key:${endpoint}`),
}));

function makeRequest(endpoint = 'https://example.com/push/device-1'): NextRequest {
  return new NextRequest('http://localhost/api/user/push-subscription/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

describe('API Route - Push Subscription Status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      pushNotificationsEnabled: true,
    } as never);
    vi.mocked(prisma.userDevice.count).mockResolvedValue(1);
    vi.mocked(prisma.userDevice.findFirst).mockResolvedValue({
      id: 'device-1',
    } as never);
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: 'public-key',
      vapidPrivateKey: 'private-key',
    });
  });

  it('reports providerConfigured true only when effective Web Push is deliverable', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accountEnabled: true,
      deviceRegistered: true,
      totalDevices: 1,
      providerConfigured: true,
    });
  });

  it('keeps device registration visible but reports providerConfigured false when server Push is disabled', async () => {
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: false,
      provider: null,
    });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accountEnabled: true,
      deviceRegistered: true,
      totalDevices: 1,
      providerConfigured: false,
    });
  });

  it('reports providerConfigured false for an incomplete effective provider', async () => {
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: 'public-key',
    });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providerConfigured).toBe(false);
  });
});
