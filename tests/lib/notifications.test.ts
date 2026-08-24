import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendNotification } from '@/lib/notifications';
import prisma from '@/lib/prisma';
import * as emailModule from '@/lib/email';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notification: { create: vi.fn(), update: vi.fn() },
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

  it('should return error for unknown channel', async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notif-4', attempts: 0 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    // @ts-expect-error - testing runtime unknown channel
    const result = await sendNotification('inc-1', 'user-1', 'INVALID_CHANNEL', 'msg');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown channel');
  });
});
