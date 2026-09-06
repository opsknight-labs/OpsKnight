import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import DashboardIncidentFilters from '@/components/dashboard/DashboardIncidentFilters';
import DashboardCommandCenter from '@/components/dashboard/DashboardCommandCenter';
import MetricCard from '@/components/dashboard/MetricCard';
import LiveClock from '@/components/dashboard/LiveClock';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const realtime = vi.hoisted(() => ({ metrics: null as null | Record<string, number> }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => ({
    get: vi.fn((key: string) => {
      if (key === 'range') return '30';
      return null;
    }),
    toString: () => '',
  }),
  usePathname: () => '/',
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => ({ metrics: realtime.metrics }),
}));

describe('Dashboard Flicker Fixes & Command Center Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtime.metrics = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('DashboardIncidentFilters Debouncing & Stability', () => {
    const defaultProps = {
      services: [{ id: 'srv-1', name: 'API Service' }],
      users: [{ id: 'usr-1', name: 'Dev User' }],
      currentStatus: 'all',
      currentUrgency: 'all',
      currentService: 'all',
      currentAssignee: 'all',
      currentSearch: '',
      currentSort: 'newest',
      currentRange: '30',
      userId: 'usr-1',
    };

    it('debounces search input by 300ms to prevent per-keystroke server re-renders', () => {
      vi.useFakeTimers();
      try {
        render(<DashboardIncidentFilters {...defaultProps} />);
        const searchInput = screen.getByPlaceholderText('Search...');

        fireEvent.change(searchInput, { target: { value: 'dat' } });
        // Should not call router.push immediately
        expect(mockPush).not.toHaveBeenCalled();

        // Advance by 150ms (less than 300ms debounce threshold)
        act(() => {
          vi.advanceTimersByTime(150);
        });
        expect(mockPush).not.toHaveBeenCalled();

        // Advance past 300ms threshold
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/?search=dat', { scroll: false });
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it('immediately submits search on Enter key without waiting for debounce', () => {
      render(<DashboardIncidentFilters {...defaultProps} />);
      const searchInput = screen.getByPlaceholderText('Search...');

      fireEvent.change(searchInput, { target: { value: 'outage' } });
      fireEvent.keyDown(searchInput, { key: 'Enter' });
      expect(mockPush).toHaveBeenCalledWith('/?search=outage', { scroll: false });
    });

    it('syncs local search input when currentSearch prop updates externally', () => {
      const { rerender } = render(<DashboardIncidentFilters {...defaultProps} currentSearch="" />);
      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('');

      rerender(<DashboardIncidentFilters {...defaultProps} currentSearch="production" />);
      expect(searchInput.value).toBe('production');
    });
  });

  describe('MetricCard Count-Up Stability', () => {
    it('displays initial numeric value immediately on mount without starting from zero', () => {
      render(<MetricCard label="ACTIVE" value={42} variant="hero" />);
      // Should immediately display 42 without flashing 0
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders N/A when data state is unavailable or no_data', () => {
      render(<MetricCard label="TOTAL" value={10} dataState="unavailable" />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Data unavailable');
    });
  });

  describe('DashboardCommandCenter Stability', () => {
    it('renders refresh and export buttons synchronously without Suspense fallbacks', () => {
      render(
        <DashboardCommandCenter
          systemStatus={{
            label: 'OPERATIONAL',
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
          }}
          allActiveIncidentsCount={0}
          totalInRange={15}
          currentActiveCount={0}
          currentTriggeredCount={0}
          currentMutedCount={0}
          currentSnoozedCount={0}
          currentSuppressedCount={0}
          metricsResolvedCount={15}
          unassignedCount={0}
          rangeLabel="30d"
          incidents={[]}
          filters={{}}
          currentAcknowledgedCount={0}
        />
      );

      // Verify the command center title and operational status
      expect(screen.getByText('Command Center')).toBeInTheDocument();
      expect(screen.getByText('OPERATIONAL')).toBeInTheDocument();

      // Refresh button should be present immediately
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      // Export button should be present immediately
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    });

    it('does not overwrite filtered counters with organization-wide realtime metrics', () => {
      realtime.metrics = {
        open: 27,
        acknowledged: 5,
        active: 32,
        resolved24h: 4,
        highUrgency: 10,
        snoozed: 3,
        suppressed: 2,
        unassigned: 8,
      };
      render(
        <DashboardCommandCenter
          systemStatus={{ label: 'OPERATIONAL', color: 'text-emerald-500', bg: '' }}
          allActiveIncidentsCount={3}
          totalInRange={3}
          currentActiveCount={3}
          currentTriggeredCount={3}
          currentAcknowledgedCount={0}
          currentMutedCount={0}
          currentSnoozedCount={0}
          currentSuppressedCount={0}
          metricsResolvedCount={0}
          unassignedCount={1}
          rangeLabel="30d"
          incidents={[]}
          filters={{ service: 'service-a' }}
        />
      );
      expect(screen.getAllByText('3').length).toBeGreaterThan(0);
      expect(screen.queryByText('32')).toBeNull();
      expect(screen.getByText('OPERATIONAL')).toBeInTheDocument();
    });
  });

  describe('LiveClock Rendering', () => {
    it('renders live clock timer element without throwing', () => {
      render(<LiveClock timeZone="UTC" />);
      expect(
        screen.getByRole('timer', { hidden: true }) || screen.getByLabelText(/Loading clock/i)
      ).toBeDefined();
    });
  });
});
