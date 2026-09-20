import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserNotificationChannels: vi.fn(),
  createInAppNotifications: vi.fn(),
  createCentralNotificationIntent: vi.fn(),
  deliverCentralNotification: vi.fn(),
  pinNotificationProviderKeys: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/user-notifications', () => ({
  getUserNotificationChannels: mocks.getUserNotificationChannels,
}));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: mocks.createInAppNotifications,
}));
vi.mock('@/lib/notification-control-plane', () => ({
  createCentralNotificationIntent: mocks.createCentralNotificationIntent,
  deliverCentralNotification: mocks.deliverCentralNotification,
  pinNotificationProviderKeys: mocks.pinNotificationProviderKeys,
}));

import prisma from '@/lib/prisma';
import {
  deliverEscalationNotificationIntents,
  materializeEscalationNotificationIntents,
  planEscalationNotificationIntents,
} from '@/lib/escalation/notification-intents';

const input = {
  incident: {
    id: 'inc-1',
    title: 'Checkout latency',
    status: 'OPEN',
    urgency: 'HIGH' as const,
    createdAt: new Date('2026-04-01T09:00:00.000Z'),
    serviceId: 'svc-1',
  },
  recipients: ['user-1'],
  stepChannels: ['SMS' as const],
  eventKey: 'ESCALATION:inc-1:policy-1:0:0',
  displayMessage: 'Checkout latency',
  generation: 0,
  stepIndex: 0,
};

describe('central escalation notification intents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      status: 'ACTIVE',
      email: 'responder@example.com',
      phoneNumber: '+15550100',
      timeZone: 'UTC',
      quietHoursEnabled: false,
      quietHoursStartMinutes: 0,
      quietHoursEndMinutes: 0,
      quietHoursWeekendAllDay: false,
    } as never);
    mocks.getUserNotificationChannels.mockResolvedValue(['SMS']);
    mocks.pinNotificationProviderKeys.mockResolvedValue(new Map([['SMS', 'twilio']]));
    mocks.createCentralNotificationIntent.mockResolvedValue({
      id: 'notification-central',
      created: true,
    });
    mocks.deliverCentralNotification.mockResolvedValue({ success: true, claimed: true });
  });

  it('materializes every responder page in the central control plane', async () => {
    const plan = await planEscalationNotificationIntents(input);
    const result = await materializeEscalationNotificationIntents({} as never, plan);
    expect(plan.controlPlane).toBe(true);
    expect(result).toEqual({ created: 1 });
    expect(plan.intents[0].storedId).toBe('notification-central');
    expect(mocks.createCentralNotificationIntent).toHaveBeenCalledWith(
      expect.objectContaining({ trafficClass: 'CRITICAL', channel: 'SMS' }),
      expect.anything()
    );
  });

  it('delivers by the central row id and leaves failures queued', async () => {
    const plan = await planEscalationNotificationIntents(input);
    await materializeEscalationNotificationIntents({} as never, plan);
    mocks.deliverCentralNotification.mockResolvedValue({ success: false, claimed: true });
    await expect(deliverEscalationNotificationIntents(plan)).resolves.toEqual([
      { userId: 'user-1', channel: 'SMS', outcome: 'QUEUED' },
    ]);
    expect(mocks.deliverCentralNotification).toHaveBeenCalledWith('notification-central');
  });

  it('reports a newly unavailable endpoint as skipped without dispatching a phantom intent', async () => {
    const plan = await planEscalationNotificationIntents(input);
    mocks.createCentralNotificationIntent.mockResolvedValue({
      id: 'notification-skipped',
      created: true,
      skipped: true,
    });

    await materializeEscalationNotificationIntents({} as never, plan);

    await expect(deliverEscalationNotificationIntents(plan)).resolves.toEqual([
      { userId: 'user-1', channel: 'SMS', outcome: 'SKIPPED' },
    ]);
    expect(mocks.deliverCentralNotification).not.toHaveBeenCalled();
  });
});
