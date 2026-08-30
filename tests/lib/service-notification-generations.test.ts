import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { sendServiceNotifications } from '@/lib/service-notifications';
import { notifySlackForIncident, sendSlackMessageToChannel } from '@/lib/slack';
import { sendIncidentWebhook } from '@/lib/webhooks';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { incident: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/slack', () => ({
  notifySlackForIncident: vi.fn(),
  sendSlackMessageToChannel: vi.fn(),
}));
vi.mock('@/lib/webhooks', () => ({ sendIncidentWebhook: vi.fn() }));
vi.mock('@/lib/delivery-idempotency', () => ({
  deliveryMarkerId: vi.fn(() => 'marker'),
  isDeliveryComplete: vi.fn(() => false),
  markDeliveryComplete: vi.fn(),
}));

describe('service notification lifecycle generations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not emit a late acknowledge notification after resolution', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc-1',
      status: 'RESOLVED',
      createdAt: new Date('2026-08-30T11:00:00.000Z'),
      updatedAt: new Date('2026-08-30T11:05:00.000Z'),
      acknowledgedAt: new Date('2026-08-30T11:02:00.000Z'),
      resolvedAt: new Date('2026-08-30T11:05:00.000Z'),
      serviceId: 'svc-1',
      service: {
        id: 'svc-1',
        serviceNotificationChannels: ['SLACK', 'WEBHOOK'],
        webhookIntegrations: [],
      },
      assignee: null,
    } as never);

    await expect(
      sendServiceNotifications('inc-1', 'acknowledged', {
        eventAt: new Date('2026-08-30T11:02:00.000Z'),
      })
    ).resolves.toEqual({ success: true });

    expect(notifySlackForIncident).not.toHaveBeenCalled();
    expect(sendSlackMessageToChannel).not.toHaveBeenCalled();
    expect(sendIncidentWebhook).not.toHaveBeenCalled();
  });

  it('does not let an older resolve job send for a newer resolve generation', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc-1',
      status: 'RESOLVED',
      createdAt: new Date('2026-08-30T11:00:00.000Z'),
      updatedAt: new Date('2026-08-30T11:10:00.000Z'),
      acknowledgedAt: new Date('2026-08-30T11:08:00.000Z'),
      resolvedAt: new Date('2026-08-30T11:10:00.000Z'),
      serviceId: 'svc-1',
      service: {
        id: 'svc-1',
        serviceNotificationChannels: ['WEBHOOK'],
        webhookIntegrations: [],
      },
      assignee: null,
    } as never);

    await expect(
      sendServiceNotifications('inc-1', 'resolved', {
        eventAt: new Date('2026-08-30T11:05:00.000Z'),
      })
    ).resolves.toEqual({ success: true });

    expect(sendIncidentWebhook).not.toHaveBeenCalled();
  });
});
