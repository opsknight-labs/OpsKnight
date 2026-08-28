import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, update, updateMany, backgroundJobCreate, transaction } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  backgroundJobCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: { findFirst, update },
    $transaction: transaction,
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getSMSConfig: vi.fn().mockResolvedValue({ authToken: 'twilio-secret' }),
  getWhatsAppConfig: vi.fn().mockResolvedValue({ authToken: null }),
}));

vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://ops.example.com'),
}));

import { POST } from '@/app/api/webhooks/notifications/twilio/route';

function signedRequest(body: string, signatureOverride?: string) {
  const url = 'https://ops.example.com/api/webhooks/notifications/twilio?notificationId=notif-1';
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

describe('Twilio delivery receipt webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue({
      id: 'notif-1',
      incidentId: 'incident-1',
      userId: 'user-1',
      channel: 'SMS',
      message: 'message',
      eventType: 'resolved',
    });
    update.mockResolvedValue({ id: 'notif-1' });
    updateMany.mockResolvedValue({ count: 1 });
    backgroundJobCreate.mockResolvedValue({ id: 'job-1' });
    transaction.mockImplementation(async callback =>
      callback({
        notification: { updateMany },
        backgroundJob: { create: backgroundJobCreate },
      })
    );
  });

  it('verifies the callback and records delivered messages', async () => {
    const response = await POST(signedRequest('MessageSid=SM123&MessageStatus=delivered'));

    expect(response.status).toBe(204);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: expect.objectContaining({
          providerMessageId: 'SM123',
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
          failedAt: null,
          errorMsg: null,
        }),
      })
    );
  });

  it('rejects an invalid Twilio signature without mutating state', async () => {
    const response = await POST(
      signedRequest('MessageSid=SM123&MessageStatus=undelivered', 'invalid')
    );

    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves notification intent when scheduling a failed-delivery fallback', async () => {
    const response = await POST(
      signedRequest('MessageSid=SM123&MessageStatus=undelivered&ErrorCode=30003')
    );

    expect(response.status).toBe(204);
    expect(backgroundJobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'NOTIFICATION',
        payload: expect.objectContaining({
          sourceNotificationId: 'notif-1',
          eventType: 'resolved',
        }),
      }),
    });
  });
});
