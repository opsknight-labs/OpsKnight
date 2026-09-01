import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserNotificationChannels: vi.fn(),
  createInAppNotifications: vi.fn(),
  dispatchNotificationAttempt: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    notification: { updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/user-notifications', () => ({
  getUserNotificationChannels: mocks.getUserNotificationChannels,
}));

vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: mocks.createInAppNotifications,
}));

vi.mock('@/lib/notification-delivery', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/notification-delivery')>();
  return { ...actual, dispatchNotificationAttempt: mocks.dispatchNotificationAttempt };
});

import prisma from '@/lib/prisma';
import {
  deliverEscalationNotificationIntents,
  materializeEscalationNotificationIntents,
  planEscalationNotificationIntents,
} from '@/lib/escalation/notification-intents';

const INCIDENT = {
  id: 'inc-1',
  title: 'Checkout latency',
  status: 'OPEN',
  urgency: 'HIGH' as const,
  createdAt: new Date('2026-04-01T09:00:00.000Z'),
  serviceId: 'svc-1',
  service: { id: 'svc-1', name: 'Checkout' },
  assignee: null,
  team: null,
};

function activeRecipient(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ACTIVE',
    email: 'responder@example.com',
    phoneNumber: '+15550100',
    timeZone: 'UTC',
    quietHoursEnabled: false,
    quietHoursStartMinutes: 0,
    quietHoursEndMinutes: 0,
    quietHoursWeekendAllDay: false,
    ...overrides,
  };
}

function planInput(overrides: Record<string, unknown> = {}) {
  return {
    incident: INCIDENT,
    recipients: ['user-1'],
    eventKey: 'ESCALATION:inc-1:policy-1:0:0',
    displayMessage: '[OpsKnight] Incident: Checkout latency',
    generation: 0,
    stepIndex: 0,
    ...overrides,
  };
}

function transactionDouble() {
  return {
    notification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NOTIFICATION_CONTROL_PLANE_PERSONAL;
  vi.mocked(prisma.user.findUnique).mockResolvedValue(activeRecipient() as never);
  vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
  mocks.getUserNotificationChannels.mockResolvedValue(['EMAIL', 'SMS']);
  mocks.createInAppNotifications.mockResolvedValue(undefined);
  mocks.dispatchNotificationAttempt.mockResolvedValue({ success: true, outcome: 'DELIVERED' });
});

describe('planning a step’s pages', () => {
  it('plans one intent per reachable channel and writes nothing', async () => {
    const plan = await planEscalationNotificationIntents(planInput());

    expect(plan.intents.map(intent => intent.channel).sort()).toEqual(['EMAIL', 'SMS']);
    expect(plan.inAppUserIds).toEqual(['user-1']);
    expect(plan.unreachableUserIds).toEqual([]);
    expect(mocks.createInAppNotifications).not.toHaveBeenCalled();
  });

  it('intersects the step’s channels with what the recipient has enabled', async () => {
    const plan = await planEscalationNotificationIntents(planInput({ stepChannels: ['SMS'] }));

    expect(plan.intents.map(intent => intent.channel)).toEqual(['SMS']);
  });

  it('falls back to recipient preferences when no configured channel is available', async () => {
    mocks.getUserNotificationChannels.mockResolvedValue(['EMAIL']);

    const plan = await planEscalationNotificationIntents(planInput({ stepChannels: ['SMS'] }));

    expect(plan.intents.map(intent => intent.channel)).toEqual(['EMAIL']);
  });

  it('never pages a recipient who is no longer active', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      activeRecipient({ status: 'DISABLED' }) as never
    );

    const plan = await planEscalationNotificationIntents(planInput());

    expect(plan.intents).toEqual([]);
    expect(plan.inAppUserIds).toEqual([]);
    expect(plan.unreachableUserIds).toEqual(['user-1']);
  });

  it('records a recipient with no reachable channel as unreachable', async () => {
    mocks.getUserNotificationChannels.mockResolvedValue([]);

    const plan = await planEscalationNotificationIntents(planInput());

    expect(plan.intents).toEqual([]);
    // Still gets the in-app record, so the page is visible somewhere.
    expect(plan.inAppUserIds).toEqual(['user-1']);
    expect(plan.unreachableUserIds).toEqual(['user-1']);
  });

  it('skips a channel the recipient has no address for', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      activeRecipient({ phoneNumber: null }) as never
    );

    const plan = await planEscalationNotificationIntents(planInput());

    expect(plan.intents.map(intent => intent.channel)).toEqual(['EMAIL']);
  });

  it('lets the notification domain apply quiet hours', async () => {
    // Quiet hours apply only to LOW urgency, and suppress disruptive channels.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      activeRecipient({
        quietHoursEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 24 * 60 - 1,
      }) as never
    );

    const plan = await planEscalationNotificationIntents(
      planInput({ incident: { ...INCIDENT, urgency: 'LOW' } })
    );

    expect(plan.intents.map(intent => intent.channel)).not.toContain('SMS');
  });

  it('keeps paging a HIGH urgency incident through quiet hours', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      activeRecipient({
        quietHoursEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 24 * 60 - 1,
      }) as never
    );

    const plan = await planEscalationNotificationIntents(planInput());

    expect(plan.intents.map(intent => intent.channel)).toContain('SMS');
  });

  it('gives every recipient/channel pair a stable identity', async () => {
    const first = await planEscalationNotificationIntents(planInput());
    const second = await planEscalationNotificationIntents(planInput());

    expect(first.intents.map(intent => intent.notificationId)).toEqual(
      second.intents.map(intent => intent.notificationId)
    );
    expect(new Set(first.intents.map(intent => intent.notificationId)).size).toBe(
      first.intents.length
    );
  });

  it('gives a later generation different intent identities', async () => {
    const first = await planEscalationNotificationIntents(planInput({ generation: 0 }));
    const reopened = await planEscalationNotificationIntents(planInput({ generation: 1 }));

    expect(first.intents[0].notificationId).not.toBe(reopened.intents[0].notificationId);
  });

  it('plans nothing for an empty audience', async () => {
    const plan = await planEscalationNotificationIntents(planInput({ recipients: [] }));

    expect(plan.intents).toEqual([]);
    expect(plan.durableMessage).toBe('');
  });
});

describe('materializing a step’s pages', () => {
  it('writes the intents and in-app records through the caller’s transaction', async () => {
    const plan = await planEscalationNotificationIntents(planInput());
    const tx = transactionDouble();

    const result = await materializeEscalationNotificationIntents(tx as never, plan);

    expect(result.created).toBe(1);
    expect(tx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    const written = tx.notification.createMany.mock.calls[0][0].data;
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      incidentId: 'inc-1',
      userId: 'user-1',
      status: 'PENDING',
      eventType: 'triggered',
      attempts: 0,
    });
    expect(mocks.createInAppNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-1'], dedupeKey: plan.eventKey }),
      tx
    );
  });

  it('lets a write failure abort the caller’s transaction', async () => {
    const plan = await planEscalationNotificationIntents(planInput());
    const tx = transactionDouble();
    tx.notification.createMany.mockRejectedValue(new Error('intent write failed'));

    await expect(materializeEscalationNotificationIntents(tx as never, plan)).rejects.toThrow(
      'intent write failed'
    );
  });

  it('still records the in-app page when no external channel survived', async () => {
    mocks.getUserNotificationChannels.mockResolvedValue([]);
    const plan = await planEscalationNotificationIntents(planInput());
    const tx = transactionDouble();

    const result = await materializeEscalationNotificationIntents(tx as never, plan);

    expect(result.created).toBe(0);
    expect(tx.notification.createMany).not.toHaveBeenCalled();
    expect(mocks.createInAppNotifications).toHaveBeenCalled();
  });
});

describe('delivering committed pages', () => {
  it('marks a delivered page as sent', async () => {
    const plan = await planEscalationNotificationIntents(planInput({ stepChannels: ['SMS'] }));

    const outcomes = await deliverEscalationNotificationIntents(plan);

    expect(outcomes).toEqual([{ userId: 'user-1', channel: 'SMS', outcome: 'DELIVERED' }]);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      })
    );
  });

  it('parks a provider failure for the retry sweeper instead of losing it', async () => {
    mocks.dispatchNotificationAttempt.mockResolvedValue({
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      error: 'provider timeout',
    });
    const plan = await planEscalationNotificationIntents(planInput({ stepChannels: ['SMS'] }));

    const outcomes = await deliverEscalationNotificationIntents(plan);

    expect(outcomes[0].outcome).toBe('RETRYABLE_FAILURE');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });

  it('never throws out of delivery, whatever the provider does', async () => {
    mocks.dispatchNotificationAttempt.mockRejectedValue(new Error('provider exploded'));
    vi.mocked(prisma.notification.updateMany).mockRejectedValue(new Error('database gone'));
    const plan = await planEscalationNotificationIntents(planInput({ stepChannels: ['SMS'] }));

    // The step is already durable; delivery must not surface as a step failure.
    await expect(deliverEscalationNotificationIntents(plan)).resolves.toEqual([
      { userId: 'user-1', channel: 'SMS', outcome: 'RETRYABLE_FAILURE' },
    ]);
  });

  it('keeps delivering after one channel fails', async () => {
    mocks.dispatchNotificationAttempt
      .mockRejectedValueOnce(new Error('provider exploded'))
      .mockResolvedValueOnce({ success: true, outcome: 'DELIVERED' });
    const plan = await planEscalationNotificationIntents(planInput());

    const outcomes = await deliverEscalationNotificationIntents(plan);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.map(outcome => outcome.outcome)).toContain('DELIVERED');
  });
});
