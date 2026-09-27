import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incidentFindUnique: vi.fn(),
  incidentUpdate: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationUpdateMany: vi.fn(),
  attemptFindUnique: vi.fn(),
  attemptUpdateMany: vi.fn(),
  feedbackCreate: vi.fn(),
  endpointUpsert: vi.fn(),
  endpointFindUnique: vi.fn(),
  endpointCreate: vi.fn(),
  endpointUpdateMany: vi.fn(),
  incidentEventCreate: vi.fn(),
  executeLifecycle: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  notification: { updateMany: mocks.notificationUpdateMany },
  notificationDeliveryAttempt: { updateMany: mocks.attemptUpdateMany },
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
    incident: {
      findUnique: mocks.incidentFindUnique,
      update: mocks.incidentUpdate,
    },
    notification: {
      findFirst: mocks.notificationFindFirst,
      updateMany: mocks.notificationUpdateMany,
    },
    notificationDeliveryAttempt: {
      findUnique: mocks.attemptFindUnique,
      updateMany: mocks.attemptUpdateMany,
    },
    notificationProviderFeedback: {
      create: mocks.feedbackCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: vi.fn().mockResolvedValue({
    enabled: true,
    authToken: 'twilio-secret-for-integration',
    fromNumber: '+14155550100',
  }),
  getTwilioVoiceCallbackCredentials: vi.fn().mockResolvedValue({
    authToken: 'twilio-secret-for-integration',
    accountSid: 'AC123',
  }),
}));

vi.mock('@/lib/app-url', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://ops.example.com'),
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  executeIncidentLifecycleCommand: mocks.executeLifecycle,
}));

import { POST as gatherPOST } from '@/app/api/webhooks/notifications/twilio/voice/gather/route';
import { POST as statusPOST } from '@/app/api/webhooks/notifications/twilio/voice/status/route';
import { createVoiceCallbackToken } from '@/lib/voice/token';

function sign(url: string, body: string, secret = 'twilio-secret-for-integration'): string {
  const params = new URLSearchParams(body);
  const sorted = Array.from(params.keys())
    .sort()
    .map(key => `${key}${params.get(key) || ''}`)
    .join('');
  return createHmac('sha1', secret).update(`${url}${sorted}`).digest('base64');
}

describe('Voice escalation integration flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_CALLBACK_SIGNING_SECRET = 'test-voice-signing-secret-at-least-32-characters';
    mocks.transaction.mockImplementation(async cb => cb(tx));
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.attemptUpdateMany.mockResolvedValue({ count: 1 });
    mocks.feedbackCreate.mockResolvedValue({ id: 'feedback-1' });
    mocks.endpointUpsert.mockResolvedValue({ id: 'ep-1' });
    mocks.endpointFindUnique.mockResolvedValue(null);
    mocks.endpointCreate.mockResolvedValue({ id: 'ep-1' });
  });

  it('Step 1 Voice page -> Press 1 -> Canonical ACK -> Incident acknowledged with correct source', async () => {
    // 1. Incident is OPEN, Step 1 escalates to Jane via VOICE
    mocks.notificationFindFirst.mockResolvedValue({
      id: 'notif-100',
      channel: 'VOICE',
      userId: 'user-jane',
      incidentId: 'incident-42',
      providerMessageId: 'CA_VOICE_CALL_1',
      user: { id: 'user-jane', name: 'Jane Doe' },
      incident: { status: 'OPEN', escalationGeneration: 1 },
    });
    mocks.attemptFindUnique.mockResolvedValue({
      id: 'attempt-100',
      notificationId: 'notif-100',
      providerMessageId: 'CA_VOICE_CALL_1',
    });
    mocks.executeLifecycle.mockResolvedValue({ status: 'ACKNOWLEDGED', changed: true });

    // 2. Token created when call was placed
    const token = createVoiceCallbackToken({
      notificationId: 'notif-100',
      deliveryAttemptId: 'attempt-100',
      userId: 'user-jane',
      incidentId: 'incident-42',
      escalationGeneration: 1,
    });

    // 3. Jane answers and presses "1" on keypad
    const gatherUrl = `https://ops.example.com/api/webhooks/notifications/twilio/voice/gather?token=${encodeURIComponent(token)}`;
    const gatherBody = 'CallSid=CA_VOICE_CALL_1&Digits=1';
    const gatherReq = new NextRequest(gatherUrl, {
      method: 'POST',
      body: gatherBody,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': sign(gatherUrl, gatherBody),
      },
    });

    const response = await gatherPOST(gatherReq);
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toContain('Thank you. The incident has been acknowledged.');

    // 4. Verify canonical lifecycle ACK command was executed with VOICE source
    expect(mocks.executeLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'incident-42',
        command: 'ACKNOWLEDGE',
        source: 'VOICE',
        expectedStatus: 'OPEN',
        actor: { id: 'user-jane', name: 'Jane Doe' },
        eventMessage: 'Incident acknowledged by Jane Doe via voice call',
      })
    );

    // 5. Verify attempt outcome was updated to ACKNOWLEDGED
    expect(mocks.attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-100' },
        data: expect.objectContaining({ outcome: 'ACKNOWLEDGED' }),
      })
    );
  });

  it('Step 1 Voice page -> no-answer -> Notification FAILED with 0 nextAttemptAt -> Escalation advances', async () => {
    // Call went unanswered
    mocks.attemptFindUnique.mockResolvedValue({
      id: 'attempt-101',
      notificationId: 'notif-101',
      providerMessageId: 'CA_VOICE_CALL_2',
      notification: {
        id: 'notif-101',
        status: 'SENT',
        maxAttempts: 3,
        incidentId: 'incident-42',
        userId: 'user-jane',
        user: { name: 'Jane Doe' },
        recipientHash: 'recipient-hash-101',
      },
    });

    const statusUrl =
      'https://ops.example.com/api/webhooks/notifications/twilio/voice/status?notificationId=notif-101&attemptId=attempt-101';
    const statusBody = 'CallSid=CA_VOICE_CALL_2&CallStatus=no-answer';
    const statusReq = new NextRequest(statusUrl, {
      method: 'POST',
      body: statusBody,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': sign(statusUrl, statusBody),
      },
    });

    const response = await statusPOST(statusReq);
    expect(response.status).toBe(204);

    // Verify notification was marked FAILED without scheduling another retry
    const updateCall = mocks.notificationUpdateMany.mock.calls[0]?.[0];
    expect(updateCall.data).toMatchObject({
      status: 'FAILED',
      attempts: 3, // Exhausts attempts so it does not retry
    });
    expect(updateCall.data).not.toHaveProperty('nextAttemptAt');

    // Attempt outcome marked NO-ANSWER
    expect(mocks.attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-101' },
        data: expect.objectContaining({ outcome: 'NO-ANSWER' }),
      })
    );
  });
});
