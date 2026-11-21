import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generation: vi.fn().mockResolvedValue('g1') }));
vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: mocks.generation,
}));

import {
  cached,
  cachedWithTime,
  invalidateCached,
  resetAnalyticsCacheForTests,
} from '@/lib/analytics/cache';

const T0 = new Date('2026-11-20T10:00:00.000Z').getTime();

describe('analytics cache', () => {
  beforeEach(() => {
    resetAnalyticsCacheForTests();
    mocks.generation.mockResolvedValue('g1');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('serves a fresh hit without recomputing and reports when it was computed', async () => {
    const compute = vi.fn().mockResolvedValue('v1');
    expect(await cachedWithTime('k', compute)).toEqual({ value: 'v1', asOf: new Date(T0) });
    vi.setSystemTime(T0 + 10_000);
    expect(await cachedWithTime('k', compute)).toEqual({ value: 'v1', asOf: new Date(T0) });
    expect(await cached('k', compute)).toBe('v1');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('fails closed: recomputes when the change signal is unavailable', async () => {
    const compute = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    expect(await cached('k', compute)).toBe('v1');
    mocks.generation.mockResolvedValue(null);
    expect(await cached('k', compute)).toBe('v2');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('serves stale data while one refresh runs, then the refreshed value', async () => {
    const compute = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    await cachedWithTime('k', compute);
    vi.setSystemTime(T0 + 60_000); // past fresh (30s), within stale (5m)
    expect(await cachedWithTime('k', compute)).toEqual({ value: 'old', asOf: new Date(T0) });
    await new Promise(resolve => setTimeout(resolve, 0)); // let the background refresh land
    expect(await cachedWithTime('k', compute)).toEqual({
      value: 'new',
      asOf: new Date(T0 + 60_000),
    });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('recomputes after a forced invalidation, only for matching keys', async () => {
    const compute = vi.fn().mockResolvedValueOnce('a1').mockResolvedValueOnce('a2');
    const other = vi.fn().mockResolvedValue('b1');
    await cachedWithTime('kpis|scopeA|range=7d|UTC', compute);
    await cachedWithTime('kpis|scopeB|range=7d|UTC', other);
    vi.setSystemTime(T0 + 5_000);
    expect(invalidateCached('|scopeA|range=7d|')).toBe(1);
    expect(await cachedWithTime('kpis|scopeA|range=7d|UTC', compute)).toEqual({
      value: 'a2',
      asOf: new Date(T0 + 5_000),
    });
    expect(await cached('kpis|scopeB|range=7d|UTC', other)).toBe('b1');
    expect(other).toHaveBeenCalledTimes(1);
  });
});
