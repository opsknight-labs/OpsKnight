import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ statusPageSubscriptionToken: { createMany: vi.fn() } }));

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/encryption', () => ({ getEncryptionKey: () => 'a'.repeat(64) }));

import { issueUnsubscribeTokensBatch } from '@/lib/status-pages/subscription-tokens';

beforeEach(() => vi.clearAllMocks());

describe('issueUnsubscribeTokensBatch', () => {
  it('issues the same link for the same subscriber and fan-out, so a retry adds no row', async () => {
    const first = await issueUnsubscribeTokensBatch(['sub-1', 'sub-2'], 'page:incident:key');
    const retry = await issueUnsubscribeTokensBatch(['sub-1', 'sub-2'], 'page:incident:key');

    expect(retry).toEqual(first);
    const [firstCall, retryCall] = db.statusPageSubscriptionToken.createMany.mock.calls;
    expect(retryCall[0].data).toEqual(firstCall[0].data);
    expect(retryCall[0].skipDuplicates).toBe(true);
  });

  it('gives each subscriber and each fan-out its own token', async () => {
    const one = await issueUnsubscribeTokensBatch(['sub-1', 'sub-2'], 'event-a');
    const other = await issueUnsubscribeTokensBatch(['sub-1'], 'event-b');

    expect(one.get('sub-1')).not.toBe(one.get('sub-2'));
    expect(one.get('sub-1')).not.toBe(other.get('sub-1'));
    expect(one.get('sub-1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stays random without a scope', async () => {
    const a = await issueUnsubscribeTokensBatch(['sub-1']);
    const b = await issueUnsubscribeTokensBatch(['sub-1']);

    expect(a.get('sub-1')).not.toBe(b.get('sub-1'));
  });
});
