import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCache, getCachedOrFetch, getCachedRecentIncidents } from '@/lib/realtime-cache';

describe('realtime cache', () => {
  beforeEach(() => clearCache());

  it('coalesces concurrent cache misses', async () => {
    let complete!: (value: { count: number }) => void;
    const fetcher = vi.fn(() => new Promise<{ count: number }>(resolve => (complete = resolve)));

    const first = getCachedOrFetch('shared', fetcher);
    const second = getCachedOrFetch('shared', fetcher);
    complete({ count: 1 });

    const results = await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.data)).toEqual([{ count: 1 }, { count: 1 }]);
  });

  it('starts the TTL when a slow fetch completes', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        return { count: 1 };
      });

      const first = getCachedOrFetch('slow', fetcher, 1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await first;
      await vi.advanceTimersByTimeAsync(999);

      await expect(getCachedOrFetch('slow', fetcher, 1_000)).resolves.toMatchObject({
        fromCache: true,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not share sensitive alert source projections with globally scoped restricted readers', async () => {
    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.findMany).mockResolvedValue([
      {
        id: 'protected',
        title: 'Customer ABC123 failure',
        description: 'ABC123',
        automationDecision: { incidentId: 'protected' },
        automationTraces: [],
        slaPausedMs: BigInt(0),
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);
    const privileged = await getCachedRecentIncidents('admin', 'ADMIN', [], undefined, 'privacy');
    const restricted = await getCachedRecentIncidents(
      'auditor',
      'AUDITOR',
      [],
      undefined,
      'privacy'
    );
    if (!privileged || !restricted) throw new Error('Expected initial incident cache projections');
    expect(privileged.data[0].title).toContain('ABC123');
    expect(JSON.stringify(restricted.data)).not.toContain('ABC123');
    expect(restricted.data[0].title).toBe('Restricted alert content');
  });
});
