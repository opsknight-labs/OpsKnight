import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateManyNotification: vi.fn(),
  updateManyAttempt: vi.fn(),
  transaction: vi.fn(),
  fetchCall: vi.fn(),
  getCredentials: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      findMany: mocks.findMany,
      updateMany: mocks.updateManyNotification,
    },
    notificationDeliveryAttempt: {
      updateMany: mocks.updateManyAttempt,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getTwilioVoiceCallbackCredentials: mocks.getCredentials,
}));

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    calls: vi.fn(() => ({
      fetch: mocks.fetchCall,
    })),
  })),
}));

import { reconcileStaleVoiceCalls } from '@/lib/voice/reconciliation';

describe('Active reconciliation of stale SENT voice calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentials.mockResolvedValue({
      accountSid: 'FAKE_SID_TEST',
      authToken: 'secret_token',
    });
    mocks.updateManyNotification.mockResolvedValue({ count: 1 });
    mocks.updateManyAttempt.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        notification: { updateMany: mocks.updateManyNotification },
        notificationDeliveryAttempt: { updateMany: mocks.updateManyAttempt },
      };
      return callback(tx);
    });
  });

  it('reconciles completed voice calls to DELIVERED when webhook was dropped', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-1',
        status: 'SENT',
        providerMessageId: 'CA_COMPLETED_123',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-1', providerMessageId: 'CA_COMPLETED_123' }],
      },
    ]);
    mocks.fetchCall.mockResolvedValue({
      sid: 'CA_COMPLETED_123',
      status: 'completed',
    });

    const result = await reconcileStaleVoiceCalls(new Date('2026-09-27T12:00:00Z'));

    expect(result.checked).toBe(1);
    expect(result.reconciled).toBe(1);

    expect(mocks.updateManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SENT', 'DELIVERED'] } }),
        data: expect.objectContaining({ status: 'DELIVERED', reconciliationDeadline: null }),
      })
    );
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-1',
          finishedAt: null,
          outcome: { in: ['ACCEPTED', 'IN_FLIGHT', 'RINGING', 'IN-PROGRESS', 'ANSWERED'] },
        },
        data: expect.objectContaining({ outcome: 'COMPLETED', finishedAt: expect.any(Date) }),
      })
    );
  });

  it('reconciles in-progress voice calls to DELIVERED without terminal finishedAt', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-in-prog',
        status: 'SENT',
        providerMessageId: 'CA_IN_PROGRESS_123',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-in-prog', providerMessageId: 'CA_IN_PROGRESS_123' }],
      },
    ]);
    mocks.fetchCall.mockResolvedValue({
      sid: 'CA_IN_PROGRESS_123',
      status: 'in-progress',
    });

    const now = new Date('2026-09-27T12:00:00Z');
    const result = await reconcileStaleVoiceCalls(now);

    expect(result.checked).toBe(1);
    expect(result.reconciled).toBe(1);

    // Notification promoted from SENT → DELIVERED with a next-poll deadline (not null)
    expect(mocks.updateManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-in-prog', status: 'SENT' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          reconciliationDeadline: expect.any(Date), // re-scheduled, NOT null
        }),
      })
    );
    // Attempt stays open (no finishedAt) — just transitions to IN-PROGRESS outcome
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-in-prog',
          finishedAt: null,
          outcome: { in: ['ACCEPTED', 'IN_FLIGHT', 'RINGING', 'IN-PROGRESS', 'ANSWERED'] },
        },
        data: { outcome: 'IN-PROGRESS' },
      })
    );
  });

  it('polls DELIVERED notification with IN-PROGRESS attempt and re-schedules next poll', async () => {
    // Scenario: notification is DELIVERED (in-progress callback already arrived),
    // but the final "completed" callback was dropped. Reconciler must keep polling.
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-delivered-open',
        status: 'DELIVERED',
        providerMessageId: 'CA_STILL_RINGING',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-open', providerMessageId: 'CA_STILL_RINGING' }],
      },
    ]);
    mocks.fetchCall.mockResolvedValue({ sid: 'CA_STILL_RINGING', status: 'in-progress' });

    // Lease CAS must accept DELIVERED status
    mocks.updateManyNotification.mockResolvedValueOnce({ count: 1 }); // lease claim
    mocks.updateManyNotification.mockResolvedValue({ count: 0 }); // SENT update no-op (already DELIVERED)

    const now = new Date('2026-09-27T12:00:00Z');
    const result = await reconcileStaleVoiceCalls(now);

    expect(result.checked).toBe(1);
    expect(result.reconciled).toBe(1);

    // Lease CAS must allow DELIVERED
    expect(mocks.updateManyNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'notif-delivered-open',
          status: { in: ['SENT', 'DELIVERED'] },
        }),
        data: expect.objectContaining({ reconciliationDeadline: expect.any(Date) }),
      })
    );

    // Next-poll re-schedule for DELIVERED notification
    expect(mocks.updateManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-delivered-open', status: 'DELIVERED' },
        data: expect.objectContaining({ reconciliationDeadline: expect.any(Date) }),
      })
    );
  });

  it('closes DELIVERED notification when Twilio returns completed (lost completed webhook)', async () => {
    // Scenario: notification already DELIVERED, attempt still IN-PROGRESS,
    // "completed" callback was dropped. Reconciler fetches Twilio and closes everything.
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-delivered-complete',
        status: 'DELIVERED',
        providerMessageId: 'CA_NOW_DONE',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-done', providerMessageId: 'CA_NOW_DONE' }],
      },
    ]);
    mocks.fetchCall.mockResolvedValue({ sid: 'CA_NOW_DONE', status: 'completed' });

    const now = new Date('2026-09-27T12:00:00Z');
    const result = await reconcileStaleVoiceCalls(now);

    expect(result.checked).toBe(1);
    expect(result.reconciled).toBe(1);

    // Notification must be updated with reconciliationDeadline: null (closed)
    expect(mocks.updateManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SENT', 'DELIVERED'] } }),
        data: expect.objectContaining({ reconciliationDeadline: null }),
      })
    );
    // Attempt must be closed with finishedAt set
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-done',
          finishedAt: null,
          outcome: { in: ['ACCEPTED', 'IN_FLIGHT', 'RINGING', 'IN-PROGRESS', 'ANSWERED'] },
        },
        data: expect.objectContaining({ outcome: 'COMPLETED', finishedAt: expect.any(Date) }),
      })
    );
  });

  it('skips notifications when CAS lease is claimed by another worker', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-contended',
        status: 'SENT',
        providerMessageId: 'CA_CONTENDED_123',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-contended', providerMessageId: 'CA_CONTENDED_123' }],
      },
    ]);
    // Simulate lease contention: updateMany returns count: 0
    mocks.updateManyNotification.mockResolvedValueOnce({ count: 0 });

    const result = await reconcileStaleVoiceCalls(new Date('2026-09-27T12:00:00Z'));

    expect(result.checked).toBe(0);
    expect(result.reconciled).toBe(0);
    expect(mocks.fetchCall).not.toHaveBeenCalled();
  });

  it('reconciles no-answer voice calls to FAILED when webhook was dropped', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-2',
        status: 'SENT',
        providerMessageId: 'CA_NO_ANSWER_456',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-2', providerMessageId: 'CA_NO_ANSWER_456' }],
      },
    ]);
    mocks.fetchCall.mockResolvedValue({
      sid: 'CA_NO_ANSWER_456',
      status: 'no-answer',
    });

    const result = await reconcileStaleVoiceCalls(new Date('2026-09-27T12:00:00Z'));

    expect(result.checked).toBe(1);
    expect(result.reconciled).toBe(1);

    expect(mocks.updateManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SENT', 'DELIVERED'] } }),
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-2',
          finishedAt: null,
          outcome: { in: ['ACCEPTED', 'IN_FLIGHT', 'RINGING', 'IN-PROGRESS', 'ANSWERED'] },
        },
        data: expect.objectContaining({ outcome: 'NO-ANSWER' }),
      })
    );
  });

  it('scans for open attempts using finishedAt: null in deliveryAttempts filter', async () => {
    mocks.findMany.mockResolvedValue([]);
    await reconcileStaleVoiceCalls(new Date('2026-09-27T12:00:00Z'));
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['SENT', 'DELIVERED'] },
          deliveryAttempts: expect.objectContaining({
            some: expect.objectContaining({ finishedAt: null }),
          }),
        }),
      })
    );
  });

  it('does nothing when no stale calls are present', async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await reconcileStaleVoiceCalls(new Date('2026-09-27T12:00:00Z'));

    expect(result.checked).toBe(0);
    expect(result.reconciled).toBe(0);
    expect(mocks.fetchCall).not.toHaveBeenCalled();
  });
});
