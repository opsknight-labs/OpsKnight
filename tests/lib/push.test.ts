import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPush } from '@/lib/push';
import prisma from '@/lib/prisma';
import { getPushConfig } from '@/lib/notification-providers';
import webpush from 'web-push';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    userDevice: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getPushConfig: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn(),
  },
}));

describe('sendPush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it('sends web push when provider is web-push', async () => {
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: 'public-key',
      vapidPrivateKey: 'private-key',
      vapidSubject: 'mailto:test@example.com',
    });

    vi.mocked(prisma.userDevice.findMany).mockResolvedValue([
      {
        id: 'device-1',
        deviceId: 'endpoint-1',
        token: JSON.stringify({
          endpoint: 'https://example.com',
          keys: { p256dh: 'p256', auth: 'auth' },
        }),
        platform: 'web',
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.userDevice.findMany>>);

    const result = await sendPush({
      userId: 'user-1',
      title: 'Test Title',
      body: 'Test Body',
      data: { url: '/m' },
    });

    expect(result.success).toBe(true);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        vapidDetails: {
          subject: 'mailto:test@example.com',
          publicKey: 'public-key',
          privateKey: 'private-key',
        },
      })
    );
    expect(prisma.userDevice.update).toHaveBeenCalledWith({
      where: { id: 'device-1' },
      data: { lastUsed: expect.any(Date) },
    });
  });

  it('returns error when no web devices exist for web-push', async () => {
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: 'public-key',
      vapidPrivateKey: 'private-key',
    });

    vi.mocked(prisma.userDevice.findMany).mockResolvedValue([
      {
        id: 'device-2',
        deviceId: 'token-1',
        token: 'token',
        platform: 'ios',
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.userDevice.findMany>>);

    const result = await sendPush({
      userId: 'user-2',
      title: 'No Web Device',
      body: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No web push subscriptions found for user');
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('safely handles actions passed as array without throwing JSON parse error', async () => {
    vi.mocked(getPushConfig).mockResolvedValue({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: 'public-key',
      vapidPrivateKey: 'private-key',
      vapidSubject: 'mailto:test@example.com',
    });

    vi.mocked(prisma.userDevice.findMany).mockResolvedValue([
      {
        id: 'device-actions',
        deviceId: 'endpoint-actions',
        token: JSON.stringify({
          endpoint: 'https://example.com/push',
          keys: { p256dh: 'p256', auth: 'auth' },
        }),
        platform: 'web',
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.userDevice.findMany>>);

    const result = await sendPush({
      userId: 'user-3',
      title: 'Incident Alert',
      body: 'High severity incident',
      data: {
        actions: [{ action: 'ack', title: 'Acknowledge' }] as any,
      },
    });

    expect(result.success).toBe(true);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
    expect(payload.actions).toEqual([{ action: 'ack', title: 'Acknowledge' }]);
  });
});
