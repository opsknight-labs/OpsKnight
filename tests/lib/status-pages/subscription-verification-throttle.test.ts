import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  statusPage: { findFirst: vi.fn() },
  statusPageSubscription: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  statusPageSubscriptionService: { deleteMany: vi.fn() },
}));
const rateLimit = vi.hoisted(() => vi.fn());
const emailConfig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: rateLimit }));
vi.mock('@/lib/notification-providers', () => ({ getStatusPageEmailConfig: emailConfig }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { subscribeStatusPageRequest } from '@/lib/status-pages/subscriptions';

const allow = { allowed: true, resetAt: Date.now() + 60_000 };
const deny = { allowed: false, resetAt: Date.now() + 60_000 };

/** Lets the per-IP and per-minute guards through and decides the verification-mail limits. */
function mailLimits(result: typeof allow) {
  rateLimit.mockImplementation(async (key: string) =>
    key.startsWith('api:status-page:verification-mail:') ? result : allow
  );
}

function subscribe(body: Record<string, unknown> = {}) {
  return subscribeStatusPageRequest(
    new NextRequest('http://localhost/api/status-page/subscribe', {
      method: 'POST',
      body: JSON.stringify({ statusPageId: 'page-1', email: 'a@example.com', ...body }),
    })
  );
}

const longAgo = new Date(Date.now() - 3_600_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.statusPage.findFirst.mockResolvedValue({
    id: 'page-1',
    enabled: true,
    showSubscribe: true,
    requireAuth: false,
  });
  db.statusPageSubscription.create.mockResolvedValue({ id: 'sub-1' });
  db.statusPageSubscription.findUniqueOrThrow.mockResolvedValue({ id: 'sub-1' });
  db.statusPageSubscription.updateMany.mockResolvedValue({ count: 1 });
  emailConfig.mockResolvedValue({ enabled: false, provider: null });
});

describe('verification mail throttle', () => {
  it('refreshes a stale PENDING subscription and mails while the address is within its limit', async () => {
    mailLimits(allow);
    db.statusPageSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      state: 'PENDING',
      subscribedAt: longAgo,
      preferences: null,
    });

    expect((await subscribe()).status).toBe(200);

    expect(db.statusPageSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(emailConfig).toHaveBeenCalledTimes(1);
  });

  it('answers the same but neither rotates the link nor mails once the address is over its limit', async () => {
    mailLimits(deny);
    db.statusPageSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      state: 'PENDING',
      subscribedAt: longAgo,
      preferences: null,
    });

    const response = await subscribe();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { success: true } });
    expect(db.statusPageSubscription.updateMany).not.toHaveBeenCalled();
    expect(emailConfig).not.toHaveBeenCalled();
  });

  it('does not reactivate or mail an unsubscribed address over its limit', async () => {
    mailLimits(deny);
    db.statusPageSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      state: 'UNSUBSCRIBED',
      subscribedAt: longAgo,
      preferences: null,
    });

    expect((await subscribe()).status).toBe(200);

    expect(db.statusPageSubscription.updateMany).not.toHaveBeenCalled();
    expect(emailConfig).not.toHaveBeenCalled();
  });

  it('keeps the new subscription but sends no mail over the per-page limit', async () => {
    mailLimits(deny);
    db.statusPageSubscription.findUnique.mockResolvedValue(null);

    expect((await subscribe()).status).toBe(200);

    expect(db.statusPageSubscription.create).toHaveBeenCalledTimes(1);
    expect(emailConfig).not.toHaveBeenCalled();
  });

  it('counts mails per address and per page in windows that advance', async () => {
    mailLimits(allow);
    db.statusPageSubscription.findUnique.mockResolvedValue(null);

    await subscribe({ email: 'Mixed@Example.com' });

    const keys = rateLimit.mock.calls.filter(([key]) =>
      String(key).startsWith('api:status-page:verification-mail:')
    );
    expect(keys).toEqual([
      ['api:status-page:verification-mail:address:page-1:mixed@example.com', 5, 86_400_000],
      ['api:status-page:verification-mail:page:page-1', 1000, 3_600_000],
    ]);
  });
});
