import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const db = vi.hoisted(() => ({
  statusPage: { findFirst: vi.fn() },
  statusPageSubscription: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  statusPageSubscriptionService: { deleteMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: Date.now() + 60_000 }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { subscribeStatusPageRequest } from '@/lib/status-pages/subscriptions';

describe('status page subscription preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.statusPage.findFirst.mockResolvedValue({
      id: 'page-1',
      enabled: true,
      showSubscribe: true,
      requireAuth: false,
    });
    db.statusPageSubscription.findUnique.mockResolvedValue(null);
    db.statusPageSubscription.create.mockResolvedValue({ id: 'sub-1' });
  });

  it('stores "all services" as a database null, never a plain null Prisma rejects', async () => {
    await subscribeStatusPageRequest(
      new NextRequest('http://localhost/api/status-page/subscribe', {
        method: 'POST',
        body: JSON.stringify({ statusPageId: 'page-1', email: 'a@example.com', preferences: {} }),
      })
    );

    expect(db.statusPageSubscription.create).toHaveBeenCalledTimes(1);
    const { data } = db.statusPageSubscription.create.mock.calls[0][0];
    expect(data.preferences).toBe(Prisma.DbNull);
  });
});
