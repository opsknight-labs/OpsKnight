import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCache, getCachedOrFetch } from '@/lib/realtime-cache';

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
});
