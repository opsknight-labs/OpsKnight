import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  updateAttemptMany: vi.fn(),
  findUniqueAttempt: vi.fn(),
  findFirstAttempt: vi.fn(),
  endpointUpsert: vi.fn(),
  endpointFindUnique: vi.fn(),
  endpointCreate: vi.fn(),
  endpointUpdateMany: vi.fn(),
  incidentEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  notification: { updateMany: mocks.updateMany },
  notificationDeliveryAttempt: {
    updateMany: mocks.updateAttemptMany,
    findFirst: mocks.findFirstAttempt,
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
    notification: { findFirst: mocks.findFirst },
    notificationDeliveryAttempt: {
      findUnique: mocks.findUniqueAttempt,
      updateMany: mocks.updateAttemptMany,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: vi.fn().mockResolvedValue({ authToken: 'twilio-secret' }),
  getTwilioVoiceCallbackCredentials: vi.fn().mockResolvedValue({ authToken: 'twilio-secret' }),
}));
vi.mock('@/lib/app-url', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://ops.example.com'),
}));

import { POST } from '@/app/api/webhooks/notifications/twilio/voice/status/route';

function signedRequest(
  body: string,
  signatureOverride?: string,
  query = 'notificationId=notification-1'
) {
  const url = `https://ops.example.com/api/webhooks/notifications/twilio/voice/status?${query}`;
  const params = new URLSearchParams(body);
  const sorted = Array.from(params.keys())
    .sort()
    .map(key => `${key}${params.get(key) || ''}`)
    .join('');
  const signature = createHmac('sha1', 'twilio-secret').update(`${url}${sorted}`).digest('base64');
  return new NextRequest(url, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signatureOverride ?? signature,
    },
  });
}

describe('Twilio voice status callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: 'notification-1',
      status: 'SENT',
      maxAttempts: 3,
      providerMessageId: 'CA123',
      incidentId: 'incident-1',
      userId: 'user-1',
      user: { name: 'Jane' },
      recipientHash: 'recipient-hash',
    });
    mocks.findUniqueAttempt.mockResolvedValue(null);
    mocks.findFirstAttempt.mockResolvedValue(null);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.updateAttemptMany.mockResolvedValue({ count: 1 });
    mocks.endpointUpsert.mockResolvedValue({ id: 'endpoint-1' });
    mocks.endpointFindUnique.mockResolvedValue(null);
    mocks.endpointCreate.mockResolvedValue({ id: 'endpoint-1' });
    mocks.transaction.mockImplementation(async callback => callback(tx));
  });

  it('marks answered calls (CallStatus=in-progress) delivered and connected', async () => {
    const response = await POST(signedRequest('CallSid=CA123&CallStatus=in-progress'));
    expect(response.status).toBe(204);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) })
    );
    expect(mocks.updateAttemptMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'IN-PROGRESS' }) })
    );
    expect(mocks.endpointCreate).toHaveBeenCalled();
    expect(mocks.incidentEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        incidentId: 'incident-1',
        message: 'Voice call connected to Jane',
      }),
    });
  });

  it('records no-answer as a terminal paging outcome without degrading endpoint health', async () => {
    const response = await POST(signedRequest('CallSid=CA123&CallStatus=no-answer'));
    expect(response.status).toBe(204);
    const update = mocks.updateMany.mock.calls[0]?.[0];
    expect(update.data).toEqual(expect.objectContaining({ status: 'FAILED' }));
    expect(update.data).not.toHaveProperty('nextAttemptAt');
    expect(update.data).toHaveProperty('attempts', 3);
    // Human non-responsiveness (no-answer) must NOT degrade endpoint health:
    expect(mocks.endpointCreate).not.toHaveBeenCalled();
    expect(mocks.endpointUpdateMany).not.toHaveBeenCalled();
  });

  it('degrades endpoint health only for genuine provider failures (failed)', async () => {
    const response = await POST(signedRequest('CallSid=CA123&CallStatus=failed'));
    expect(response.status).toBe(204);
    expect(mocks.endpointCreate).toHaveBeenCalled();
  });

  it('does not mutate parent notification when a newer attempt exists (stale callback)', async () => {
    const startedAt = new Date('2026-09-27T10:00:00Z');
    mocks.findUniqueAttempt.mockResolvedValue({
      id: 'attempt-1',
      notificationId: 'notification-1',
      providerMessageId: 'CA123',
      startedAt,
      notification: {
        id: 'notification-1',
        status: 'SENT',
        maxAttempts: 3,
        incidentId: 'incident-1',
        userId: 'user-1',
        user: { name: 'Jane' },
        recipientHash: 'recipient-hash',
      },
    });
    // Newer attempt exists
    mocks.findFirstAttempt.mockResolvedValue({ id: 'attempt-2' });

    const response = await POST(
      signedRequest(
        'CallSid=CA123&CallStatus=in-progress',
        undefined,
        'notificationId=notification-1&attemptId=attempt-1'
      )
    );
    expect(response.status).toBe(204);
    // Parent notification must NOT be updated
    expect(mocks.updateMany).not.toHaveBeenCalled();
    // But the attempt itself is still monotonically updated
    expect(mocks.updateAttemptMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'attempt-1' }),
        data: expect.objectContaining({ outcome: 'IN-PROGRESS' }),
      })
    );
  });

  it('stale failed callback does not degrade endpoint health after a newer attempt succeeded', async () => {
    // Scenario: Attempt A failed → late callback arrives after Attempt B succeeded.
    // The endpoint health must NOT be decremented for the stale Attempt A callback.
    const startedAt = new Date('2026-09-27T10:00:00Z');
    mocks.findUniqueAttempt.mockResolvedValue({
      id: 'attempt-a',
      notificationId: 'notification-1',
      providerMessageId: 'CA_OLD',
      startedAt,
      finishedAt: null,
      outcome: 'ACCEPTED',
      notification: {
        id: 'notification-1',
        status: 'DELIVERED', // Attempt B already succeeded
        maxAttempts: 3,
        incidentId: 'incident-1',
        userId: 'user-1',
        user: { name: 'Jane' },
        recipientHash: 'recipient-hash',
      },
    });
    // Newer attempt exists — the newerAttempt guard fires
    mocks.findFirstAttempt.mockResolvedValue({ id: 'attempt-b' });

    const response = await POST(
      signedRequest(
        'CallSid=CA_OLD&CallStatus=failed',
        undefined,
        'notificationId=notification-1&attemptId=attempt-a'
      )
    );
    expect(response.status).toBe(204);
    // Parent notification must NOT be updated
    expect(mocks.updateMany).not.toHaveBeenCalled();
    // Endpoint health must NOT be updated (no create, no updateMany on endpoint)
    expect(mocks.endpointCreate).not.toHaveBeenCalled();
    expect(mocks.endpointUpdateMany).not.toHaveBeenCalled();
    // But the attempt itself is still advanced monotonically
    expect(mocks.updateAttemptMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'attempt-a', finishedAt: null }),
        data: expect.objectContaining({ outcome: 'FAILED' }),
      })
    );
  });

  it('rejects unsigned state changes', async () => {
    const response = await POST(
      signedRequest('CallSid=CA123&CallStatus=completed', 'invalid-signature')
    );
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
