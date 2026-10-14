import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ingest = vi.fn();
vi.mock('@/lib/notification-provider-feedback', () => ({
  ingestNotificationProviderFeedback: (...args: unknown[]) => ingest(...args),
}));

describe('provider feedback webhook', () => {
  beforeEach(() => {
    vi.resetModules();
    ingest.mockReset().mockResolvedValue({ processed: true, subscriptionId: 'sub-1' });
    process.env.NOTIFICATION_PROVIDER_FEEDBACK_SECRET = 'test-feedback-secret';
  });

  it('authenticates and ingests a typed provider event', async () => {
    const body = JSON.stringify({
      provider: 'sendgrid',
      providerEventId: 'event-1',
      providerMessageId: 'message-1',
      type: 'COMPLAINT',
      occurredAt: '2026-09-09T12:00:00.000Z',
    });
    const signature = createHmac('sha256', 'test-feedback-secret').update(body).digest('hex');
    const { POST } = await import('@/app/api/webhooks/notifications/provider-feedback/route');
    const response = await POST(
      new NextRequest('https://example.test/api/webhooks/notifications/provider-feedback', {
        method: 'POST',
        body,
        headers: { 'x-opsknight-signature': `sha256=${signature}` },
      })
    );
    expect(response.status).toBe(202);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ type: 'COMPLAINT' }));
  });

  it.each([true, false])('rejects oversized bodies with declared length %s', async declared => {
    const { POST } = await import('@/app/api/webhooks/notifications/provider-feedback/route');
    const response = await POST(
      new NextRequest('https://example.test/api/webhooks/notifications/provider-feedback', {
        method: 'POST',
        body: 'x'.repeat(65537),
        headers: {
          'x-opsknight-signature': 'a'.repeat(64),
          ...(declared ? { 'content-length': '65537' } : {}),
        },
      })
    );
    expect(response.status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
  });
  it('rejects oversized signature headers', async () => {
    const { POST } = await import('@/app/api/webhooks/notifications/provider-feedback/route');
    const response = await POST(
      new NextRequest('https://example.test/api/webhooks/notifications/provider-feedback', {
        method: 'POST',
        body: '{}',
        headers: { 'x-opsknight-signature': 'a'.repeat(10000) },
      })
    );
    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });
  it('rejects unsigned feedback', async () => {
    const { POST } = await import('@/app/api/webhooks/notifications/provider-feedback/route');
    const response = await POST(
      new NextRequest('https://example.test/api/webhooks/notifications/provider-feedback', {
        method: 'POST',
        body: '{}',
      })
    );
    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });
});
