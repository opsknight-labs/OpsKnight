import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNextNotificationRetryAt, retryFailedNotifications } from '@/lib/notification-retry';
import prisma from '@/lib/prisma';

const sendIncidentEmail = vi.fn();
const circuitExecute = vi.fn((fn: () => unknown) => fn());

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: vi.fn() },
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
  CircuitBreakerError: class CircuitBreakerError extends Error {
    serviceName: string;
    constructor(message: string, serviceName: string) {
      super(message);
      this.serviceName = serviceName;
    }
  },
  CircuitBreakerTimeoutError: class CircuitBreakerTimeoutError extends Error {},
  CircuitBreakers: {
    email: () => ({ execute: circuitExecute }),
    sms: () => ({ execute: (fn: () => unknown) => fn() }),
    push: () => ({ execute: (fn: () => unknown) => fn() }),
    whatsapp: () => ({ execute: (fn: () => unknown) => fn() }),
    webhook: () => ({ execute: (fn: () => unknown) => fn() }),
  },
}));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn().mockResolvedValue({ allowed: true }),
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
  eventType: 'acknowledged',
};

describe('notification retry claiming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    circuitExecute.mockImplementation((fn: () => unknown) => fn());
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(failedNotification.incident as never);
    vi.mocked(prisma.notification.findMany).mockResolvedValue([failedNotification] as never);
  });

  it('does not consume an attempt while the provider circuit is open', async () => {
    const { CircuitBreakerError } = await import('@/lib/circuit-breaker');
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 });
    circuitExecute.mockRejectedValue(new CircuitBreakerError('Circuit is open', 'email'));

    const result = await retryFailedNotifications();

    expect(result).toEqual({ retried: 1, succeeded: 0, failed: 1 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
        data: expect.objectContaining({ status: 'FAILED', attempts: 1 }),
      })
    );
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

    const result = await retryFailedNotifications();

    expect(result).toEqual({ retried: 1, succeeded: 1, failed: 0 });
    expect(sendIncidentEmail).toHaveBeenCalledTimes(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'notification-1', status: 'FAILED', attempts: 1 }),
      })
    );
  });

  it('fences a pre-generation triggered intent so a new g0 replay cannot duplicate it', async () => {
    const legacyId = `ntf:triggered:${Date.now()}:${'a'.repeat(64)}`;
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      {
        ...failedNotification,
        id: legacyId,
        eventType: 'triggered',
        incident: {
          ...failedNotification.incident,
          escalationGeneration: 0,
        },
      },
    ] as never);
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      ...failedNotification.incident,
      escalationGeneration: 0,
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 });

    await expect(retryFailedNotifications()).resolves.toEqual({
      retried: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(sendIncidentEmail).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: legacyId, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'SKIPPED',
          errorMsg: 'Triggered notification predates immutable escalation generation',
        }),
      })
    );
  });

  it('selects only due retries before applying the batch limit', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 });

    await retryFailedNotifications();

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          status: 'FAILED',
          deliveryKey: null,
          OR: expect.arrayContaining([
            expect.objectContaining({
              attempts: 0,
              failedAt: expect.objectContaining({ lte: expect.any(Date) }),
            }),
            expect.objectContaining({
              attempts: 1,
              failedAt: expect.objectContaining({ lte: expect.any(Date) }),
            }),
            expect.objectContaining({
              attempts: 2,
              failedAt: expect.objectContaining({ lte: expect.any(Date) }),
            }),
          ]),
        }),
      })
    );
  });

  it('excludes control-plane rows from the legacy retry owner', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 });

    await retryFailedNotifications();

    const recoveryQuery = vi.mocked(prisma.notification.updateMany).mock.calls[0]?.[0];
    expect(recoveryQuery).toEqual(
      expect.objectContaining({ where: expect.objectContaining({ deliveryKey: null }) })
    );
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deliveryKey: null }) })
    );
  });

  it('exposes the earliest failed or orphaned intent deadline to the scheduler', async () => {
    const createdAt = new Date('2026-08-30T12:00:00.000Z');
    const failedAt = new Date('2026-08-30T12:01:00.000Z');
    vi.mocked(prisma.notification.findFirst)
      .mockResolvedValueOnce({ createdAt } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ failedAt } as never)
      .mockResolvedValueOnce(null);

    await expect(getNextNotificationRetryAt()).resolves.toEqual(
      new Date(failedAt.getTime() + 10_000)
    );
  });
});
