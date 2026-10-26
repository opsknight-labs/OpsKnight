import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCache,
  getCacheStats,
  getCachedOrFetch,
  getCachedRecentIncidents,
  getCachedWhenAcceptable,
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
    const big = {
      rows: Array.from({ length: 500 }, (_, index) => ({ index, text: 'x'.repeat(40) })),
    };
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

  describe('getCachedWhenAcceptable', () => {
    type Row = { generation: number };
    const needs = (generation: number) => (data: Row) => data.generation >= generation;
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    it('serves a cached value only while it is acceptable', async () => {
      const fetcher = vi.fn(async () => ({ generation: 1 }));
      await getCachedWhenAcceptable('k', fetcher, 10_000, needs(1));
      await getCachedWhenAcceptable('k', fetcher, 10_000, needs(1));
      expect(fetcher).toHaveBeenCalledTimes(1);
      const newer = vi.fn(async () => ({ generation: 2 }));
      const result = await getCachedWhenAcceptable('k', newer, 10_000, needs(2));
      expect(result.data.generation).toBe(2);
      expect(newer).toHaveBeenCalledTimes(1);
      expect(result.hash).toBeTruthy();
    });

    it('does not let a fetch that began before the need satisfy it, and shares the replacement', async () => {
      const first = deferred<Row>();
      const early = getCachedWhenAcceptable('flight', () => first.promise, 10_000, needs(1));
      await vi.waitFor(() => expect(getCacheStats().size).toBe(0));
      // A caller that needs generation 2 arrives while the generation-1 fetch is running.
      const second = deferred<Row>();
      const fetchNewer = vi.fn(() => second.promise);
      const late = [
        getCachedWhenAcceptable('flight', fetchNewer, 10_000, needs(2)),
        getCachedWhenAcceptable('flight', fetchNewer, 10_000, needs(2)),
      ];
      first.resolve({ generation: 1 });
      await expect(early).resolves.toMatchObject({ data: { generation: 1 } });
      await vi.waitFor(() => expect(fetchNewer).toHaveBeenCalledTimes(1));
      second.resolve({ generation: 2 });
      const results = await Promise.all(late);
      expect(results.map(result => result.data.generation)).toEqual([2, 2]);
      // The unacceptable earlier result was never returned to the later callers.
      expect(fetchNewer).toHaveBeenCalledTimes(1);
    });

    it('never treats a failed fetch as fresh and does not cache it', async () => {
      const failing = vi.fn(async () => {
        throw new Error('db down');
      });
      await expect(getCachedWhenAcceptable('fail', failing, 10_000, needs(1))).rejects.toThrow(
        'db down'
      );
      const recovered = vi.fn(async () => ({ generation: 3 }));
      await expect(
        getCachedWhenAcceptable('fail', recovered, 10_000, needs(3))
      ).resolves.toMatchObject({ data: { generation: 3 } });
      expect(failing).toHaveBeenCalledTimes(1);
      // A caller waiting on a flight that fails starts its own fetch instead of inheriting it.
      const doomed = deferred<Row>();
      const waiter = getCachedWhenAcceptable('rejoin', () => doomed.promise, 10_000, needs(1));
      const independent = vi.fn(async () => ({ generation: 5 }));
      const second = getCachedWhenAcceptable('rejoin', independent, 10_000, needs(5));
      doomed.reject(new Error('boom'));
      await expect(waiter).rejects.toThrow('boom');
      await expect(second).resolves.toMatchObject({ data: { generation: 5 } });
      expect(independent).toHaveBeenCalledTimes(1);
    });

    it('keeps byte accounting exact when a stale entry is replaced', async () => {
      const big = (generation: number) => ({ generation, text: 'q'.repeat(2_000) });
      await getCachedWhenAcceptable('acct', async () => big(1), 10_000, needs(1));
      const before = getCacheStats().bytes;
      await getCachedWhenAcceptable('acct', async () => big(2), 10_000, needs(2));
      const after = getCacheStats();
      expect(after.size).toBe(1);
      expect(after.bytes).toBe(before);
    });
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
