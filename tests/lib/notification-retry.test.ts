import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retryFailedNotifications } from '@/lib/notification-retry';
import prisma from '@/lib/prisma';

const sendIncidentEmail = vi.fn();

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreakers: {
    email: () => ({ execute: (fn: () => unknown) => fn() }),
    sms: () => ({ execute: (fn: () => unknown) => fn() }),
    push: () => ({ execute: (fn: () => unknown) => fn() }),
    whatsapp: () => ({ execute: (fn: () => unknown) => fn() }),
    webhook: () => ({ execute: (fn: () => unknown) => fn() }),
  },
}));
vi.mock('@/lib/notifications', () => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendIncidentEmail }));
vi.mock('@/lib/sms', () => ({ sendIncidentSMS: vi.fn() }));
vi.mock('@/lib/push', () => ({ sendIncidentPush: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ sendIncidentWhatsApp: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ sendIncidentWebhook: vi.fn() }));

const failedNotification = {
  id: 'notification-1',
  userId: 'user-1',
  incidentId: 'incident-1',
  channel: 'EMAIL',
  status: 'FAILED',
  attempts: 1,
  failedAt: new Date(Date.now() - 60_000),
  incident: { id: 'incident-1', status: 'OPEN', service: { webhookUrl: null } },
};

describe('notification retry claiming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.findMany).mockResolvedValue([failedNotification] as never);
  });

  it('does not send when another worker already claimed the notification', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 });

    const result = await retryFailedNotifications();

    expect(result).toEqual({ retried: 0, succeeded: 0, failed: 0 });
    expect(sendIncidentEmail).not.toHaveBeenCalled();
  });

  it('sends only after an atomic FAILED-to-PENDING claim succeeds', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 });
    sendIncidentEmail.mockResolvedValue({ success: true });
    vi.mocked(prisma.notification.update).mockResolvedValue({} as never);

    const result = await retryFailedNotifications();

    expect(result).toEqual({ retried: 1, succeeded: 1, failed: 0 });
    expect(sendIncidentEmail).toHaveBeenCalledTimes(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'notification-1', status: 'FAILED', attempts: 1 }),
      })
    );
  });
});
