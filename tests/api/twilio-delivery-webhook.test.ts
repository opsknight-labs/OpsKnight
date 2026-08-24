import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMany = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  default: { notification: { updateMany } },
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
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('verifies the callback and records delivered messages', async () => {
    const response = await POST(signedRequest('MessageSid=SM123&MessageStatus=delivered'));

    expect(response.status).toBe(204);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ id: 'notif-1' }, { providerMessageId: 'SM123' }],
        },
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
    expect(updateMany).not.toHaveBeenCalled();
  });
});
