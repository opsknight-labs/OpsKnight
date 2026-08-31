import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCentralNotificationIntent,
  deliverCentralNotification,
  maskedNotificationRecipient,
} from '@/lib/notification-control-plane';
import prisma from '@/lib/prisma';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  encrypt: vi.fn(async (value: string) => `encrypted:${value}`),
  decrypt: vi.fn(async (value: string) => value.replace(/^encrypted:/, '')),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    notificationDeliveryAttempt: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/encryption', () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
  getEncryptionKey: vi.fn(() => '11'.repeat(32)),
}));
vi.mock('@/lib/email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreakerError: class CircuitBreakerError extends Error {},
  CircuitBreakers: {
    email: () => ({ execute: (operation: () => unknown) => operation() }),
    sms: () => ({ execute: (operation: () => unknown) => operation() }),
    whatsapp: () => ({ execute: (operation: () => unknown) => operation() }),
    push: () => ({ execute: (operation: () => unknown) => operation() }),
    slack: () => ({ execute: (operation: () => unknown) => operation() }),
    webhook: () => ({ execute: (operation: () => unknown) => operation() }),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const input = {
  category: 'SECURITY' as const,
  channel: 'EMAIL' as const,
  recipientType: 'EMAIL' as const,
  recipientAddress: 'Person@Example.com',
  templateKey: 'password-reset',
  sourceType: 'USER',
  sourceId: 'user-1',
  eventKey: 'reset-request-1',
  displayMessage: 'Password reset',
  payload: {
    kind: 'EMAIL' as const,
    to: 'Person@Example.com',
    subject: 'Reset password',
    html: '<p>Reset</p>',
  },
};

describe('central notification control plane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores only encrypted payloads and masked recipients', async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notification_one' } as never);

    const result = await createCentralNotificationIntent(input);

    expect(result.created).toBe(true);
    expect(mocks.encrypt).toHaveBeenCalledWith(JSON.stringify(input.payload));
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientDisplay: 'p***@example.com',
          payloadEncrypted: expect.stringMatching(/^encrypted:/),
          deliveryKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      })
    );
  });

  it('returns the durable existing intent when concurrent creation loses the unique race', async () => {
    vi.mocked(prisma.notification.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_existing',
    } as never);

    await expect(createCentralNotificationIntent(input)).resolves.toEqual({
      id: 'notification_existing',
      created: false,
    });
  });

  it('uses one atomic claim when two workers race for the same delivery', async () => {
    const due = new Date(Date.now() - 60_000);
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_race',
      status: 'PENDING',
      category: 'SECURITY',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(input.payload)}`,
    } as never);
    let claimed = false;
    vi.mocked(prisma.notification.updateMany).mockImplementation((async (
      args: Parameters<typeof prisma.notification.updateMany>[0]
    ) => {
      const data = args.data as Record<string, unknown>;
      if ('lastAttemptAt' in data && !('attempts' in data)) {
        if (claimed) return { count: 0 };
        claimed = true;
      }
      return { count: 1 };
    }) as never);
    vi.mocked(prisma.notificationDeliveryAttempt.create).mockResolvedValue({} as never);
    mocks.sendEmail.mockResolvedValue({ success: true, providerMessageId: 'provider-1' });

    const results = await Promise.all([
      deliverCentralNotification('notification_race'),
      deliverCentralNotification('notification_race'),
    ]);

    expect(results.filter(result => result.claimed)).toHaveLength(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('never redelivers an already terminal notification', async () => {
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_sent',
      status: 'SENT',
      payloadEncrypted: 'encrypted:{}',
    } as never);

    await expect(deliverCentralNotification('notification_sent')).resolves.toEqual({
      success: false,
      claimed: false,
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('masks every externally-addressed channel without exposing a full address', () => {
    expect(maskedNotificationRecipient('EMAIL', 'alice@example.com')).toBe('a***@example.com');
    expect(maskedNotificationRecipient('SMS', '+1 (555) 123-9876')).toBe('***9876');
    expect(maskedNotificationRecipient('WEBHOOK', 'https://hooks.example.com/secret/token')).toBe(
      'https://hooks.example.com'
    );
  });
});
