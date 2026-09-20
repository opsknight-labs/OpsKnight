import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { sendNotification } from '@/lib/notifications';

const centralMocks = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    notification: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: centralMocks.enqueue,
}));

const incident = {
  id: 'inc-1',
  title: 'Database latency',
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'P1',
  createdAt: new Date('2026-08-30T12:00:00.000Z'),
  updatedAt: new Date('2026-08-30T12:01:00.000Z'),
  acknowledgedAt: null,
  resolvedAt: null,
  currentEscalationStep: 0,
  escalationGeneration: 2,
  service: { id: 'svc-1', name: 'Payments' },
};

describe('personal notification control-plane routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      email: 'responder@example.com',
      phoneNumber: '+15550100',
    } as never);
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification-central',
      status: 'SENT',
      attempts: 1,
      errorMsg: null,
    } as never);
    centralMocks.enqueue.mockResolvedValue({
      id: 'notification-central',
      created: true,
      delivered: true,
    });
  });

  it('always routes supported personal channels through the encrypted central plane', async () => {
    await expect(
      sendNotification('inc-1', 'user-1', 'EMAIL', '[Payments] Database latency')
    ).resolves.toMatchObject({
      success: true,
      outcome: 'DELIVERED',
      notificationId: 'notification-central',
    });
    expect(centralMocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'INCIDENT',
        channel: 'EMAIL',
        recipientAddress: 'responder@example.com',
        payload: expect.objectContaining({
          kind: 'INCIDENT_EMAIL',
          incidentId: 'inc-1',
          userId: 'user-1',
          escalationGeneration: 2,
        }),
      })
    );
  });

  it('terminally skips a channel whose recipient address is absent', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      email: 'responder@example.com',
      phoneNumber: null,
    } as never);
    await expect(sendNotification('inc-1', 'user-1', 'SMS', 'page')).resolves.toMatchObject({
      success: true,
      outcome: 'SKIPPED',
      skipped: true,
    });
    expect(centralMocks.enqueue).not.toHaveBeenCalled();
  });

  it('treats an endpoint that bounces after recipient resolution as skipped, not retryable', async () => {
    centralMocks.enqueue.mockResolvedValue({
      id: 'notification-skipped',
      created: true,
      skipped: true,
    });
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification-skipped',
      status: 'SKIPPED',
      attempts: 0,
      errorMsg: 'Notification endpoint is unavailable: BOUNCED',
    } as never);

    await expect(sendNotification('inc-1', 'user-1', 'EMAIL', 'page')).resolves.toMatchObject({
      success: true,
      outcome: 'SKIPPED',
      skipped: true,
    });
  });

  it('does not restore the retired feature-flag fallback', async () => {
    process.env.NOTIFICATION_CONTROL_PLANE_PERSONAL = 'false';
    await sendNotification('inc-1', 'user-1', 'EMAIL', 'page');
    expect(centralMocks.enqueue).toHaveBeenCalledTimes(1);
    delete process.env.NOTIFICATION_CONTROL_PLANE_PERSONAL;
  });
});
