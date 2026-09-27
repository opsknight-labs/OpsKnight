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
        providerMessageId: 'CA_COMPLETED_123',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-1' }],
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
        where: { id: 'notif-1', status: 'SENT' },
        data: expect.objectContaining({ status: 'DELIVERED', reconciliationDeadline: null }),
      })
    );
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({ outcome: 'COMPLETED', finishedAt: expect.any(Date) }),
      })
    );
  });

  it('reconciles in-progress voice calls to DELIVERED without terminal finishedAt', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-in-prog',
        providerMessageId: 'CA_IN_PROGRESS_123',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-in-prog' }],
      },
    ]);
    mocks.fetchCall.mockResolvedValue({
      sid: 'CA_IN_PROGRESS_123',
      status: 'in-progress',
    });

    const result = await reconcileStaleVoiceCalls(new Date('2026-09-27T12:00:00Z'));

    expect(result.checked).toBe(1);
    expect(result.reconciled).toBe(1);

    expect(mocks.updateManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-in-prog', status: 'SENT' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      })
    );
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-in-prog' },
        data: { outcome: 'IN-PROGRESS' },
      })
    );
  });

  it('skips notifications when CAS lease is claimed by another worker', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'notif-contended',
        providerMessageId: 'CA_CONTENDED_123',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-contended' }],
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
        providerMessageId: 'CA_NO_ANSWER_456',
        maxAttempts: 3,
        deliveryAttempts: [{ id: 'attempt-2' }],
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
        where: { id: 'notif-2', status: 'SENT' },
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
    expect(mocks.updateManyAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-2' },
        data: expect.objectContaining({ outcome: 'NO-ANSWER' }),
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
