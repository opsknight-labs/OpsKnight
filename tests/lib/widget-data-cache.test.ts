import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getWidgetDataMock } = vi.hoisted(() => ({ getWidgetDataMock: vi.fn() }));

vi.mock('@/lib/widget-data-provider', () => ({
  getWidgetRealtimeProjection: getWidgetDataMock,
}));

import {
  buildWidgetCacheKey,
  clearWidgetDataCache,
  getCachedWidgetData,
} from '@/lib/widget-data-cache';

describe('widget data cache', () => {
  beforeEach(() => {
    clearWidgetDataCache();
    getWidgetDataMock.mockReset();
  });

  it('coalesces simultaneous equivalent widget calculations', async () => {
    let resolve!: (value: { lastUpdated: Date }) => void;
    getWidgetDataMock.mockReturnValue(new Promise(done => (resolve = done)));

    const first = getCachedWidgetData('user-1', 'ADMIN', { windowDays: 30 }, 1_000);
    const second = getCachedWidgetData('user-1', 'ADMIN', { windowDays: 30 }, 1_000);
    resolve({ lastUpdated: new Date() });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(getWidgetDataMock).toHaveBeenCalledTimes(1);
  });

  it('keeps user and dashboard filter scopes isolated', async () => {
    getWidgetDataMock.mockResolvedValue({ lastUpdated: new Date() });

    await getCachedWidgetData('user-1', 'ADMIN', { serviceId: 'svc-1' }, 1_000);
    await getCachedWidgetData('user-2', 'ADMIN', { serviceId: 'svc-1' }, 1_000);
    await getCachedWidgetData('user-1', 'ADMIN', { serviceId: 'svc-2' }, 1_000);

    expect(getWidgetDataMock).toHaveBeenCalledTimes(3);
  });

  it('evicts rejected calculations so the next poll can retry', async () => {
    getWidgetDataMock.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({});

    await expect(getCachedWidgetData('user-1', 'ADMIN', { windowDays: 7 }, 1_000)).rejects.toThrow(
      'temporary'
    );
    await expect(getCachedWidgetData('user-1', 'ADMIN', { windowDays: 7 }, 1_001)).resolves.toEqual(
      {}
    );
    expect(getWidgetDataMock).toHaveBeenCalledTimes(2);
  });

  it('canonicalizes filter order and Date values in cache keys', () => {
    const start = new Date('2026-08-01T00:00:00.000Z');
    expect(
      buildWidgetCacheKey('user-1', 'ADMIN', { startDate: start, serviceId: ['b', 'a'] })
    ).toBe(buildWidgetCacheKey('user-1', 'ADMIN', { serviceId: ['a', 'b'], startDate: start }));
  });

  it('serves stale data while one background refresh is in flight', async () => {
    vi.useFakeTimers();
    try {
      const initial = { lastUpdated: new Date(0), activeIncidents: [] };
      let finishRefresh!: (value: typeof initial) => void;
      getWidgetDataMock
        .mockResolvedValueOnce(initial)
        .mockReturnValueOnce(new Promise(resolve => (finishRefresh = resolve)));

      await getCachedWidgetData('user-1', 'ADMIN', {}, Date.now());
      await vi.advanceTimersByTimeAsync(31_000);

      await expect(getCachedWidgetData('user-1', 'ADMIN', {}, Date.now())).resolves.toBe(initial);
      await expect(getCachedWidgetData('user-1', 'ADMIN', {}, Date.now())).resolves.toBe(initial);
      expect(getWidgetDataMock).toHaveBeenCalledTimes(2);

      finishRefresh({ ...initial, lastUpdated: new Date() });
      await vi.runAllTicks();
    } finally {
      vi.useRealTimers();
    }
  });
});
