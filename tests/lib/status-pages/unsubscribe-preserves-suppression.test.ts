import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  statusPageSubscription: { updateMany: vi.fn((args: unknown) => args) },
  notification: { updateMany: vi.fn((args: unknown) => args) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/status-pages/subscription-tokens', () => ({
  findUnsubscribeSubscription: vi.fn().mockResolvedValue({
    id: 'sub-1',
    statusPage: { slug: 'acme' },
  }),
}));

import { unsubscribeByToken } from '@/lib/status-pages/unsubscribe';
import { subscriptionRequestAction } from '@/lib/status-pages/subscription-policy';

describe('unsubscribeByToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only moves consent states to UNSUBSCRIBED and keeps complaint/bounce suppression', async () => {
    await unsubscribeByToken('tok', 'acme');

    const calls = db.statusPageSubscription.updateMany.mock.calls.map(
      ([args]) => args as { where: Record<string, unknown>; data: Record<string, unknown> }
    );
    const toUnsubscribed = calls.filter(call => call.data.state === 'UNSUBSCRIBED');
    expect(toUnsubscribed).toHaveLength(1);
    expect(toUnsubscribed[0].where.state).toEqual({ in: ['PENDING', 'ACTIVE'] });

    const keepState = calls.filter(call => !('state' in call.data));
    expect(keepState).toHaveLength(1);
    expect(keepState[0].where.state).toEqual({ notIn: ['PENDING', 'ACTIVE'] });

    // A complained address therefore stays COMPLAINED, which a new sign-up never reactivates.
    expect(subscriptionRequestAction('COMPLAINED', new Date(0), Date.now())).toBe('ACCEPT');
  });
});
