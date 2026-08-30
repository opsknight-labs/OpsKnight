import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendNotification } from '@/lib/notifications';
import prisma from '@/lib/prisma';
import * as emailModule from '@/lib/email';
import * as pushModule from '@/lib/push';
import { AppError } from '@/lib/errors';

type NotificationFindResult = Awaited<ReturnType<typeof prisma.notification.findFirst>>;
type NotificationCreateResult = Awaited<ReturnType<typeof prisma.notification.create>>;
type IncidentFindResult = Awaited<ReturnType<typeof prisma.incident.findUnique>>;

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notification: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    incident: { findUnique: vi.fn() },
    incidentEvent: { create: vi.fn() },
  },
}));

// Mock sub-modules
vi.mock('@/lib/email');
vi.mock('@/lib/sms', () => ({
  sendIncidentSMS: vi.fn(),
}));
vi.mock('@/lib/push', () => ({
  sendIncidentPush: vi.fn(),
}));
vi.mock('@/lib/whatsapp', () => ({
  sendIncidentWhatsApp: vi.fn(),
}));
vi.mock('@/lib/webhooks', () => ({
  sendIncidentWebhook: vi.fn(),
}));

describe('Notifications Library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route to EMAIL channel correctly', async () => {
    const incidentId = 'inc-1';
    const userId = 'user-1';
    const message = 'Test alert';

    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notif-1', attempts: 0 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: incidentId,
      status: 'TRIGGERED',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({ success: true });

    const result = await sendNotification(incidentId, userId, 'EMAIL', message);

    expect(result.success).toBe(true);
    expect(emailModule.sendIncidentEmail).toHaveBeenCalledWith(userId, incidentId, 'triggered');
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: expect.objectContaining({ status: 'SENT' }),
      })
    );
  });

  it('should debounce an identical recent notification payload', async () => {
    const message = '[API] Incident triggered: CPU high';
    vi.mocked(prisma.notification.findFirst).mockResolvedValue({
      id: 'notif-existing',
    } as unknown as NotificationFindResult);

    const result = await sendNotification('inc-1', 'user-1', 'EMAIL', message);

    expect(result).toEqual({
      success: true,
      outcome: 'DELIVERED',
      notificationId: 'notif-existing',
      debounced: true,
    });
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          incidentId: 'inc-1',
          userId: 'user-1',
          channel: 'EMAIL',
          message,
        }),
      })
    );
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(emailModule.sendIncidentEmail).not.toHaveBeenCalled();
  });

  it('should not let a recent trigger notification suppress a resolved lifecycle message', async () => {
    const resolvedMessage = '[API] Incident resolved: CPU high';
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.notification.create).mockResolvedValue({
      id: 'notif-resolved',
      attempts: 0,
    } as unknown as NotificationCreateResult);
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc-1',
      status: 'RESOLVED',
    } as unknown as IncidentFindResult);
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({ success: true });

    const result = await sendNotification(
      'inc-1',
      'user-1',
      'EMAIL',
      resolvedMessage,
      undefined,
      'resolved'
    );

    expect(result.success).toBe(true);
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ message: resolvedMessage }),
      })
    );
    expect(prisma.notification.create).toHaveBeenCalled();
    expect(emailModule.sendIncidentEmail).toHaveBeenCalledWith('user-1', 'inc-1', 'resolved');
  });

  it('preserves acknowledged intent when the incident is already resolved', async () => {
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.notification.create).mockResolvedValue({
      id: 'notif-ack',
      attempts: 0,
    } as unknown as NotificationCreateResult);
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc-1',
      status: 'RESOLVED',
    } as unknown as IncidentFindResult);
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({ success: true });

    await sendNotification(
      'inc-1',
      'user-1',
      'EMAIL',
      'Incident acknowledged',
      undefined,
      'acknowledged'
    );

    expect(emailModule.sendIncidentEmail).toHaveBeenCalledWith('user-1', 'inc-1', 'acknowledged');
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'acknowledged' }) })
    );
  });

  it('records an unavailable push recipient as terminally skipped', async () => {
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.notification.create).mockResolvedValue({
      id: 'notif-push',
      attempts: 0,
    } as unknown as NotificationCreateResult);
    vi.mocked(pushModule.sendIncidentPush).mockResolvedValue({
      success: false,
      code: 'NO_DEVICE_TOKENS',
      error: 'No device tokens found for user',
    });

    const result = await sendNotification(
      'inc-1',
      'user-1',
      'PUSH',
      'Incident acknowledged',
      undefined,
      'acknowledged'
    );

    expect(result).toEqual(
      expect.objectContaining({ success: true, outcome: 'SKIPPED', skipped: true, terminal: true })
    );
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) })
    );
  });

  it('should route to WHATSAPP channel correctly', async () => {
    const { sendIncidentWhatsApp } = await import('@/lib/whatsapp');
    const incidentId = 'inc-2';
    const userId = 'user-2';

    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notif-2', attempts: 0 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: incidentId,
      status: 'TRIGGERED',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(sendIncidentWhatsApp).mockResolvedValue({ success: true });

    const result = await sendNotification(incidentId, userId, 'WHATSAPP', 'Hello');

    expect(result.success).toBe(true);
    expect(sendIncidentWhatsApp).toHaveBeenCalledWith(userId, incidentId, 'triggered', 'notif-2');
  });

  it('should handle delivery failure', async () => {
    const incidentId = 'inc-3';
    const userId = 'user-3';

    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notif-3', attempts: 0 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: incidentId,
      status: 'TRIGGERED',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(emailModule.sendIncidentEmail).mockResolvedValue({
      success: false,
      error: 'SMTP Error',
    });

    const result = await sendNotification(incidentId, userId, 'EMAIL', 'Fail');

    expect(result.success).toBe(false);
    expect(result.error).toBe('SMTP Error');
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-3' },
        data: expect.objectContaining({ status: 'FAILED', errorMsg: 'SMTP Error' }),
      })
    );
  });

  it('marks a typed permanent provider failure terminally without scheduling retries', async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({
      id: 'notif-permanent',
      attempts: 0,
    } as unknown as NotificationCreateResult);
    vi.mocked(emailModule.sendIncidentEmail).mockRejectedValue(
      new AppError({
        code: 'INTEGRATION_AUTHENTICATION_FAILED',
        userMessage: 'Provider credentials rejected',
        retryable: false,
      })
    );

    const result = await sendNotification('inc-4', 'user-4', 'EMAIL', 'Fail permanently');

    expect(result).toEqual(expect.objectContaining({ success: false, outcome: 'PERMANENT_FAILURE' }));
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attempts: 3 }) })
    );
  });

  it('should return error for unknown channel', async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notif-4', attempts: 0 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    // @ts-expect-error - testing runtime unknown channel
    const result = await sendNotification('inc-1', 'user-1', 'INVALID_CHANNEL', 'msg');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown channel');
  });
});
