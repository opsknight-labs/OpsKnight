import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notificationFindFirst: vi.fn(),
  notificationFindUnique: vi.fn(),
  notificationUpdateMany: vi.fn(),
  attemptFindUnique: vi.fn(),
  attemptUpdateMany: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptCreate: vi.fn(),
  feedbackCreate: vi.fn(),
  feedbackDeleteMany: vi.fn(),
  incidentFindUnique: vi.fn(),
  incidentEventCreate: vi.fn(),
  endpointUpsert: vi.fn(),
  endpointFindUnique: vi.fn(),
  endpointCreate: vi.fn(),
  endpointUpdateMany: vi.fn(),
  executeLifecycle: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  notification: { updateMany: mocks.notificationUpdateMany },
  notificationDeliveryAttempt: {
    updateMany: mocks.attemptUpdateMany,
    findFirst: mocks.attemptFindFirst,
  },
  userNotificationEndpoint: {
    upsert: mocks.endpointUpsert,
    findUnique: mocks.endpointFindUnique,
    create: mocks.endpointCreate,
    updateMany: mocks.endpointUpdateMany,
  },
  incidentEvent: { create: mocks.incidentEventCreate },
};

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      findFirst: mocks.notificationFindFirst,
      findUnique: mocks.notificationFindUnique,
      updateMany: mocks.notificationUpdateMany,
    },
    notificationDeliveryAttempt: {
      findUnique: mocks.attemptFindUnique,
      updateMany: mocks.attemptUpdateMany,
      create: mocks.attemptCreate,
    },
    notificationProviderFeedback: {
      create: mocks.feedbackCreate,
      deleteMany: mocks.feedbackDeleteMany,
    },
    incident: { findUnique: mocks.incidentFindUnique },
    incidentEvent: { create: mocks.incidentEventCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: vi.fn().mockResolvedValue({
    enabled: true,
    authToken: 'test-twilio-secret-token',
    fromNumber: '+14155550100',
  }),
  getTwilioVoiceCallbackCredentials: vi.fn().mockResolvedValue({
    authToken: 'test-twilio-secret-token',
    accountSid: 'AC123',
  }),
}));

vi.mock('@/lib/app-url', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://ops.example.com'),
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  executeIncidentLifecycleCommand: mocks.executeLifecycle,
}));

import { POST as statusPOST } from '@/app/api/webhooks/notifications/twilio/voice/status/route';
import { POST as gatherPOST } from '@/app/api/webhooks/notifications/twilio/voice/gather/route';
import { createVoiceCallbackToken } from '@/lib/voice/token';

function signUrl(url: string, body: string, secret = 'test-twilio-secret-token'): string {
  const params = new URLSearchParams(body);
  const sorted = Array.from(params.keys())
    .sort()
    .map(key => `${key}${params.get(key) || ''}`)
    .join('');
  return createHmac('sha1', secret).update(`${url}${sorted}`).digest('base64');
}

function signedStatusRequest(queryString: string, body: string) {
  const url = `https://ops.example.com/api/webhooks/notifications/twilio/voice/status?${queryString}`;
  const signature = signUrl(url, body);
  return new NextRequest(url, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
  });
}

function signedGatherRequest(token: string, body: string) {
  const url = `https://ops.example.com/api/webhooks/notifications/twilio/voice/gather?token=${encodeURIComponent(token)}`;
  const signature = signUrl(url, body);
  return new NextRequest(url, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
  });
}

describe('Twilio voice callback correlation & races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_CALLBACK_SIGNING_SECRET = 'test-voice-signing-secret-at-least-32-characters';
    mocks.transaction.mockImplementation(async cb => cb(tx));
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.attemptUpdateMany.mockResolvedValue({ count: 1 });
    mocks.endpointUpsert.mockResolvedValue({ id: 'ep-1' });
    mocks.endpointFindUnique.mockResolvedValue(null);
    mocks.endpointCreate.mockResolvedValue({ id: 'ep-1' });
  });

  describe('Attempt-level correlation isolates retries', () => {
    it('correlates callbacks to the exact attempt so Attempt A cannot claim Attempt B', async () => {
      // Notification N has two attempts:
      // Attempt 1: Call A (attempt-1)
      // Attempt 2: Call B (attempt-2)
      mocks.attemptFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'attempt-1') {
          return {
            id: 'attempt-1',
            notificationId: 'notif-1',
            providerMessageId: 'CA_CALL_A',
            notification: {
              id: 'notif-1',
              status: 'SENT',
              maxAttempts: 3,
              incidentId: 'incident-1',
              userId: 'user-1',
              user: { name: 'Jane' },
              recipientHash: 'hash-1',
            },
          };
        }
        if (where.id === 'attempt-2') {
          return {
            id: 'attempt-2',
            notificationId: 'notif-1',
            providerMessageId: 'CA_CALL_B',
            notification: {
              id: 'notif-1',
              status: 'SENT',
              maxAttempts: 3,
              incidentId: 'incident-1',
              userId: 'user-1',
              user: { name: 'Jane' },
              recipientHash: 'hash-1',
            },
          };
        }
        return null;
      });

      // Stale callback for Call A arrives with attemptId=attempt-1
      const resA = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-1',
          'CallSid=CA_CALL_A&CallStatus=completed'
        )
      );
      expect(resA.status).toBe(204);
      // Attempt 1 updated
      expect(mocks.attemptUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'attempt-1' }) })
      );

      // Now callback arrives claiming attempt-2 with Call A (mismatched CallSid)
      const resMismatch = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-2',
          'CallSid=CA_CALL_A&CallStatus=completed'
        )
      );
      // Mismatched CallSid on attempt-2 is ignored without mutating state
      expect(resMismatch.status).toBe(204);

      // Callback for Call B on attempt-2 succeeds
      const resB = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-2',
          'CallSid=CA_CALL_B&CallStatus=completed'
        )
      );
      expect(resB.status).toBe(204);
      expect(mocks.attemptUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'attempt-2' }) })
      );
    });
  });

  describe('Non-OPEN incident state handling in gather callback', () => {
    function tokenFor(incidentStatus: string, escalationGeneration = 2) {
      mocks.notificationFindFirst.mockResolvedValue({
        id: 'notif-1',
        providerMessageId: 'CA123',
        user: { id: 'user-1', name: 'Jane' },
        incident: { status: incidentStatus, escalationGeneration },
      });
      mocks.attemptFindUnique.mockResolvedValue({
        id: 'attempt-1',
        notificationId: 'notif-1',
        providerMessageId: 'CA123',
      });
      return createVoiceCallbackToken({
        notificationId: 'notif-1',
        deliveryAttemptId: 'attempt-1',
        userId: 'user-1',
        incidentId: 'incident-1',
        escalationGeneration,
      });
    }

    it('returns truthful TwiML when incident is already ACKNOWLEDGED and does not throw 500', async () => {
      const token = tokenFor('ACKNOWLEDGED');
      const response = await gatherPOST(signedGatherRequest(token, 'CallSid=CA123&Digits=1'));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('This incident is already acknowledged.');
      expect(mocks.executeLifecycle).not.toHaveBeenCalled();
    });

    it('returns truthful TwiML when incident is already RESOLVED', async () => {
      const token = tokenFor('RESOLVED');
      const response = await gatherPOST(signedGatherRequest(token, 'CallSid=CA123&Digits=1'));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('This incident is already resolved.');
      expect(mocks.executeLifecycle).not.toHaveBeenCalled();
    });

    it('returns truthful TwiML when incident is SNOOZED', async () => {
      const token = tokenFor('SNOOZED');
      const response = await gatherPOST(signedGatherRequest(token, 'CallSid=CA123&Digits=1'));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('This incident is no longer awaiting acknowledgement.');
      expect(mocks.executeLifecycle).not.toHaveBeenCalled();
    });

    it('returns truthful TwiML when incident is SUPPRESSED', async () => {
      const token = tokenFor('SUPPRESSED');
      const response = await gatherPOST(signedGatherRequest(token, 'CallSid=CA123&Digits=1'));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('This incident is no longer awaiting acknowledgement.');
      expect(mocks.executeLifecycle).not.toHaveBeenCalled();
    });
  });

  describe('Callback idempotency', () => {
    it('handles duplicate answered and completed callbacks idempotently', async () => {
      mocks.attemptFindUnique.mockResolvedValue({
        id: 'attempt-1',
        notificationId: 'notif-1',
        providerMessageId: 'CA123',
        notification: {
          id: 'notif-1',
          status: 'DELIVERED',
          maxAttempts: 3,
          incidentId: 'incident-1',
          userId: 'user-1',
          user: { name: 'Jane' },
          recipientHash: 'hash-1',
        },
      });

      const res1 = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-1',
          'CallSid=CA123&CallStatus=completed'
        )
      );
      expect(res1.status).toBe(204);

      const res2 = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-1',
          'CallSid=CA123&CallStatus=completed'
        )
      );
      expect(res2.status).toBe(204);
    });

    it('handles duplicate DTMF ACK callbacks idempotently via feedback unique key', async () => {
      mocks.notificationFindFirst.mockResolvedValue({
        id: 'notif-1',
        providerMessageId: 'CA123',
        user: { id: 'user-1', name: 'Jane' },
        incident: { status: 'OPEN', escalationGeneration: 1 },
      });
      mocks.attemptFindUnique.mockResolvedValue({
        id: 'attempt-1',
        notificationId: 'notif-1',
        providerMessageId: 'CA123',
      });
      // Second feedback insert fails with unique violation P2002
      const { Prisma } = await import('@prisma/client');
      mocks.feedbackCreate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.x',
        })
      );

      const token = createVoiceCallbackToken({
        notificationId: 'notif-1',
        deliveryAttemptId: 'attempt-1',
        userId: 'user-1',
        incidentId: 'incident-1',
        escalationGeneration: 1,
      });

      const response = await gatherPOST(signedGatherRequest(token, 'CallSid=CA123&Digits=1'));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('This incident acknowledgement was already received.');
      expect(mocks.executeLifecycle).not.toHaveBeenCalled();
    });

    it('enforces monotonic attempt state machine: ringing callback cannot overwrite COMPLETED', async () => {
      mocks.attemptFindUnique.mockResolvedValue({
        id: 'attempt-1',
        notificationId: 'notif-1',
        providerMessageId: 'CA123',
        startedAt: new Date('2026-09-27T12:00:00Z'),
        notification: {
          id: 'notif-1',
          status: 'DELIVERED',
          maxAttempts: 3,
          incidentId: 'incident-1',
          userId: 'user-1',
          user: { name: 'Jane' },
          recipientHash: 'hash-1',
        },
      });

      // A late ringing callback arrives for an already COMPLETED attempt
      const res = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-1',
          'CallSid=CA123&CallStatus=ringing'
        )
      );
      expect(res.status).toBe(204);

      // Verify the query required outcome to NOT be in terminal/connected outcomes
      const updateCall = mocks.attemptUpdateMany.mock.calls.find(
        c => c[0]?.where?.id === 'attempt-1'
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0].where.outcome).toEqual(
        expect.objectContaining({
          notIn: expect.arrayContaining(['COMPLETED', 'ACKNOWLEDGED', 'IN-PROGRESS', 'ANSWERED']),
        })
      );
    });

    it('enforces monotonic attempt state machine: failed callback cannot overwrite CONNECTED/IN-PROGRESS', async () => {
      mocks.attemptFindUnique.mockResolvedValue({
        id: 'attempt-1',
        notificationId: 'notif-1',
        providerMessageId: 'CA123',
        startedAt: new Date('2026-09-27T12:00:00Z'),
        notification: {
          id: 'notif-1',
          status: 'DELIVERED',
          maxAttempts: 3,
          incidentId: 'incident-1',
          userId: 'user-1',
          user: { name: 'Jane' },
          recipientHash: 'hash-1',
        },
      });

      // A late failed callback arrives
      const res = await statusPOST(
        signedStatusRequest(
          'notificationId=notif-1&attemptId=attempt-1',
          'CallSid=CA123&CallStatus=failed'
        )
      );
      expect(res.status).toBe(204);

      // Verify update requires outcome NOT in connected outcomes
      const updateCall = mocks.attemptUpdateMany.mock.calls.find(
        c => c[0]?.where?.id === 'attempt-1'
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0].where.outcome).toEqual(
        expect.objectContaining({
          notIn: expect.arrayContaining(['IN-PROGRESS', 'ANSWERED', 'COMPLETED', 'ACKNOWLEDGED']),
        })
      );
    });
  });
});
