import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  updateAttemptMany: vi.fn(),
  endpointUpsert: vi.fn(),
  endpointFindUnique: vi.fn(),
  endpointCreate: vi.fn(),
  endpointUpdateMany: vi.fn(),
  incidentEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  notification: { updateMany: mocks.updateMany },
  notificationDeliveryAttempt: { updateMany: mocks.updateAttemptMany },
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
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: vi.fn().mockResolvedValue({ authToken: 'twilio-secret' }),
}));
vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://ops.example.com'),
}));

import { POST } from '@/app/api/webhooks/notifications/twilio/voice/status/route';

function signedRequest(body: string, signatureOverride?: string) {
  const url =
    'https://ops.example.com/api/webhooks/notifications/twilio/voice/status?notificationId=notification-1';
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
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.updateAttemptMany.mockResolvedValue({ count: 1 });
    mocks.endpointUpsert.mockResolvedValue({ id: 'endpoint-1' });
    mocks.endpointFindUnique.mockResolvedValue(null);
    mocks.endpointCreate.mockResolvedValue({ id: 'endpoint-1' });
    mocks.transaction.mockImplementation(async callback => callback(tx));
  });

  it('marks answered calls delivered and updates endpoint health', async () => {
    const response = await POST(signedRequest('CallSid=CA123&CallStatus=answered'));
    expect(response.status).toBe(204);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) })
    );
    expect(mocks.updateAttemptMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'ANSWERED' }) })
    );
    expect(mocks.endpointCreate).toHaveBeenCalled();
    expect(mocks.incidentEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        incidentId: 'incident-1',
        message: 'Voice call connected to Jane',
      }),
    });
  });

  it('records no-answer as a terminal paging outcome without creating a provider retry', async () => {
    const response = await POST(signedRequest('CallSid=CA123&CallStatus=no-answer'));
    expect(response.status).toBe(204);
    const update = mocks.updateMany.mock.calls[0]?.[0];
    expect(update.data).toEqual(expect.objectContaining({ status: 'FAILED' }));
    expect(update.data).not.toHaveProperty('nextAttemptAt');
    expect(update.data).toHaveProperty('attempts', 3);
  });

  it('rejects unsigned state changes', async () => {
    const response = await POST(
      signedRequest('CallSid=CA123&CallStatus=completed', 'invalid-signature')
    );
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
