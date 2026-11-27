import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  canonical: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/status-page-resolver', () => ({ resolveStatusPage: mocks.resolve }));
vi.mock('@/lib/status-pages/subscriptions', () => ({
  subscribeStatusPageRequest: mocks.canonical,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));

import { subscribeToStatusPage } from '@/app/api/status/subscribe/handler';

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/status/ops/subscribe', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function forwarded() {
  return (mocks.canonical.mock.calls[0][0] as NextRequest).json();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canonical.mockResolvedValue(new Response('{}', { status: 200 }));
  mocks.resolve.mockResolvedValue({ id: 'page-1' });
});

describe('compatibility subscribe route', () => {
  it('forwards the timezone and the service picks instead of dropping them', async () => {
    await subscribeToStatusPage(
      post({
        email: 'a@example.com',
        timezone: 'Asia/Kolkata',
        preferences: { selectedServiceIds: ['svc-1'] },
      }),
      'ops'
    );

    expect(await forwarded()).toEqual({
      statusPageId: 'page-1',
      email: 'a@example.com',
      timezone: 'Asia/Kolkata',
      preferences: { selectedServiceIds: ['svc-1'] },
    });
  });

  it('does not fall back to a page id in the body when the slug is unknown', async () => {
    mocks.resolve.mockResolvedValue(null);

    const response = await subscribeToStatusPage(
      post({ email: 'a@example.com', statusPageId: 'some-other-page' }),
      'missing'
    );

    expect(response.status).toBe(404);
    expect(mocks.canonical).not.toHaveBeenCalled();
  });

  it('leaves rate limiting to the canonical endpoint so a request is charged once', async () => {
    await subscribeToStatusPage(post({ email: 'a@example.com' }), 'ops');

    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.canonical).toHaveBeenCalledTimes(1);
  });
});
