import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ useDashboardAnalytics: vi.fn() }));

vi.mock('@/components/dashboard/DashboardAnalyticsProvider', () => ({
  useDashboardAnalytics: mocks.useDashboardAnalytics,
}));

import { DashboardAnalyticsHeatmap } from '@/components/dashboard/DashboardAnalyticsWidgets';

const snapshot = {
  heatmapData: [] as Array<{ date: string; count: number }>,
};

describe('DashboardAnalyticsHeatmap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says the history is unavailable when the heatmap query failed, instead of an all-zero calendar', () => {
    mocks.useDashboardAnalytics.mockReturnValue({
      data: { ...snapshot, heatmapAvailable: false },
      state: 'fresh',
    });

    render(<DashboardAnalyticsHeatmap />);

    expect(screen.getByText('Incident history is temporarily unavailable.')).toBeTruthy();
  });

  it('draws the calendar when the query succeeded with no incidents', () => {
    mocks.useDashboardAnalytics.mockReturnValue({
      data: { ...snapshot, heatmapAvailable: true },
      state: 'fresh',
    });

    render(<DashboardAnalyticsHeatmap />);

    expect(screen.queryByText('Incident history is temporarily unavailable.')).toBeNull();
  });
});
