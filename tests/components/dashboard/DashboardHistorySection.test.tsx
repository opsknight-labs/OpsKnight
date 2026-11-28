import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ useDashboardAnalytics: vi.fn() }));

vi.mock('@/components/dashboard/DashboardAnalyticsProvider', () => ({
  DashboardAnalyticsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useActivateDashboardAnalytics: vi.fn(),
  useDashboardAnalytics: mocks.useDashboardAnalytics,
}));
vi.mock('@/components/dashboard/DashboardAnalyticsWidgets', () => ({
  DashboardAnalyticsHeatmap: () => <div />,
}));
vi.mock('@/components/dashboard/compact/CompactTeamLoad', () => ({ default: () => <div /> }));
vi.mock('@/components/dashboard/live/LiveDashboardProvider', () => ({
  useLiveDashboard: () => ({ snapshot: null }),
}));

import DashboardHistorySection, {
  DashboardHistoryProvider,
} from '@/components/dashboard/DashboardHistorySection';

class VisibleImmediately {
  constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe() {
    this.callback([{ isIntersecting: true }]);
  }
  disconnect() {}
}

describe('DashboardHistorySection links into Analytics', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', VisibleImmediately);
    mocks.useDashboardAnalytics.mockReturnValue({ data: null, state: 'unavailable' });
  });

  it.each(['7', '30', '90'] as const)(
    'sends the %s-day view to the Analytics range it understands, from both links',
    range => {
      render(
        <DashboardHistoryProvider initialQuery={{ range }}>
          <DashboardHistorySection />
        </DashboardHistoryProvider>
      );

      const hrefs = screen
        .getAllByRole('link')
        .map(link => link.getAttribute('href'))
        .filter(href => href?.startsWith('/insights'));
      expect(hrefs).toEqual([`/insights?range=${range}d`, `/insights?range=${range}d`]);
    }
  );
});
