import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardAnalyticsProvider } from '@/components/dashboard/DashboardAnalyticsProvider';

const response = {
  data: {
    mtta: 1,
    mttr: 2,
    ackCompliance: 100,
    resolveCompliance: 100,
    heatmapData: [],
    serviceMetrics: [],
    assigneeLoad: [],
    effectiveStart: '2026-09-01T00:00:00.000Z',
    effectiveEnd: '2026-09-06T00:00:00.000Z',
    isClipped: false,
    retentionDays: 90,
    asOf: '2026-09-06T00:00:00.000Z',
    sourceGeneration: '1',
    freshness: 'fresh',
  },
};

describe('DashboardAnalyticsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(response) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads once and does not poll every 30 seconds', async () => {
    render(
      <DashboardAnalyticsProvider query={{ range: '30' }}>
        <div>dashboard</div>
      </DashboardAnalyticsProvider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a shed request using Retry-After', async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'Retry-After': '1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(response),
      } as unknown as Response);
    render(
      <DashboardAnalyticsProvider query={{ range: '30' }}>
        <div>dashboard</div>
      </DashboardAnalyticsProvider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_100);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('performs only slow jittered reconciliation for a continuously visible tab', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(
      <DashboardAnalyticsProvider query={{ range: '30' }}>
        <div>dashboard</div>
      </DashboardAnalyticsProvider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
