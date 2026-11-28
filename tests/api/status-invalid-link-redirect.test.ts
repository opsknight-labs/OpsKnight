import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  statusPageSubscription: { findFirst: vi.fn(), updateMany: vi.fn() },
}));
const unsubscribeByToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/app-config', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://ops.example.com'),
}));
vi.mock('@/lib/status-pages/subscription-tokens', () => ({
  hashSubscriptionToken: (token: string) => `hash:${token}`,
}));
vi.mock('@/lib/status-pages/unsubscribe', () => ({ unsubscribeByToken }));

import { POST as verify } from '@/app/api/status/subscriptions/verify/route';
import { POST as unsubscribe } from '@/app/api/status/subscriptions/unsubscribe/route';

function post(path: string, host: string, body: Record<string, string>) {
  return new NextRequest(`https://${host}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', host },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.statusPageSubscription.findFirst.mockResolvedValue(null);
  unsubscribeByToken.mockResolvedValue(null);
});

describe('invalid or expired subscription links', () => {
  it('send a custom domain to the status path that says so, not to /status (a 404 there)', async () => {
    const confirmed = await verify(
      post('/api/status/subscriptions/verify', 'status.example.com', { token: 'tok' })
    );
    expect(confirmed.status).toBe(303);
    expect(new URL(confirmed.headers.get('location')!).pathname).toBe('/verify/tok');

    const left = await unsubscribe(
      post('/api/status/subscriptions/unsubscribe', 'status.example.com', { token: 'tok' })
    );
    expect(new URL(left.headers.get('location')!).pathname).toBe('/unsubscribe/tok');
  });

  it('send the application host to the matching /status page', async () => {
    const confirmed = await verify(
      post('/api/status/subscriptions/verify', 'ops.example.com', { token: 'tok' })
    );
    expect(new URL(confirmed.headers.get('location')!).pathname).toBe('/status/verify/tok');

    const left = await unsubscribe(
      post('/api/status/subscriptions/unsubscribe', 'ops.example.com', { token: 'tok' })
    );
    expect(new URL(left.headers.get('location')!).pathname).toBe('/status/unsubscribe/tok');
  });

  it('fall back to the page root when there is no usable token', async () => {
    const response = await verify(
      post('/api/status/subscriptions/verify', 'status.example.com', {})
    );
    expect(new URL(response.headers.get('location')!).pathname).toBe('/');
  });
});
