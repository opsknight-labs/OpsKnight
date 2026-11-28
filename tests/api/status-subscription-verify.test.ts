/* eslint-disable @typescript-eslint/no-explicit-any -- partial prisma mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

vi.mock('@/lib/status-page-url', () => ({ getStatusPagePublicUrl: () => '/status' }));
vi.mock('@/lib/status-pages/subscription-tokens', () => ({
  hashSubscriptionToken: (token: string) => `hash:${token}`,
}));

import { POST } from '@/app/api/status/subscriptions/verify/route';

const db = prisma as any;

function verify() {
  return POST(
    new NextRequest('http://localhost/api/status/subscriptions/verify', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok' }),
      headers: { 'content-type': 'application/json' },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.statusPageSubscription = { findFirst: vi.fn(), updateMany: vi.fn() };
  db.statusPageSubscription.findFirst.mockResolvedValue({
    id: 'sub-1',
    state: 'COMPLAINED',
    preferences: null,
    verificationTokenExpiresAt: null,
    statusPage: { slug: 'status' },
  });
  db.statusPageSubscription.updateMany.mockResolvedValue({ count: 0 });
});

describe('POST /api/status/subscriptions/verify', () => {
  it('confirms only subscriptions that are still pending or already active', async () => {
    await verify();
    const { where, data } = db.statusPageSubscription.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ verified: true, state: 'ACTIVE' });
    // A complained, bounced or suppressed row keeps its old verification link; it must not match.
    expect(where.state).toEqual({ in: ['PENDING', 'ACTIVE'] });
  });
});
