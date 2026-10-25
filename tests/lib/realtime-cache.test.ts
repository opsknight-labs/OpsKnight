import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCache,
  getCacheStats,
  getCachedOrFetch,
  getCachedRecentIncidents,
} from '@/lib/realtime-cache';

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
  it('detects change with a compact digest instead of retaining the serialized payload', async () => {
    const big = { rows: Array.from({ length: 500 }, (_, index) => ({ index, text: 'x'.repeat(40) })) };
    const first = await getCachedOrFetch('digest', async () => big, 1_000);
    expect(first.hash.length).toBeLessThan(64);
    const same = await getCachedOrFetch('digest-same', async () => structuredClone(big), 1_000);
    expect(same.hash).toBe(first.hash);
    const changed = await getCachedOrFetch(
      'digest-changed',
      async () => ({ rows: [...big.rows, { index: -1, text: '' }] }),
      1_000
    );
    expect(changed.hash).not.toBe(first.hash);
    expect(getCacheStats().bytes).toBeGreaterThan(0);
  });

  it('evicts oldest entries to stay inside the byte budget and skips oversized entries', async () => {
    vi.resetModules();
    vi.stubEnv('REALTIME_CACHE_MAX_BYTES', String(40_000));
    try {
      const fresh = await import('@/lib/realtime-cache');
      fresh.clearCache();
      const payload = (seed: number) => ({ seed, text: 'y'.repeat(4_000) });
      for (let index = 0; index < 12; index += 1) {
        await fresh.getCachedOrFetch(`budget:${index}`, async () => payload(index), 60_000);
      }
      const stats = fresh.getCacheStats();
      expect(stats.bytes).toBeLessThanOrEqual(40_000);
      expect(stats.size).toBeLessThan(12);
      // The newest entry survives; the oldest was evicted and must be refetched.
      const newest = vi.fn(async () => payload(11));
      await expect(fresh.getCachedOrFetch('budget:11', newest, 60_000)).resolves.toMatchObject({
        fromCache: true,
      });
      const oldest = vi.fn(async () => payload(0));
      await fresh.getCachedOrFetch('budget:0', oldest, 60_000);
      expect(oldest).toHaveBeenCalledTimes(1);

      // An entry above a quarter of the budget is returned but never retained.
      const huge = vi.fn(async () => ({ text: 'z'.repeat(20_000) }));
      await fresh.getCachedOrFetch('huge', huge, 60_000);
      await fresh.getCachedOrFetch('huge', huge, 60_000);
      expect(huge).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
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
