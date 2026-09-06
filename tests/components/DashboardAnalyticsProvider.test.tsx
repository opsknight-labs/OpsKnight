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
});
