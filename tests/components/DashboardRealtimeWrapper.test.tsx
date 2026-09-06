import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardRealtimeWrapper from '@/components/DashboardRealtimeWrapper';

// Mock useRealtime hook (overridden per test as needed)
const useRealtimeMock = vi.fn(() => ({
  isConnected: true,
  metrics: { open: 5, acknowledged: 3, resolved24h: 10, highUrgency: 2 },
  recentIncidents: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  error: null,
}));
const refreshMock = vi.fn();

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => useRealtimeMock(),
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe('DashboardRealtimeWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(
      <DashboardRealtimeWrapper>
        <div>Test Content</div>
      </DashboardRealtimeWrapper>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should call onMetricsUpdate when metrics change', () => {
    const onMetricsUpdate = vi.fn();

    render(
      <DashboardRealtimeWrapper onMetricsUpdate={onMetricsUpdate}>
        <div>Test</div>
      </DashboardRealtimeWrapper>
    );

    // Metrics should be passed to callback
    expect(onMetricsUpdate).toHaveBeenCalled();
  });

  it('should call onIncidentsUpdate when incidents change', () => {
    const onIncidentsUpdate = vi.fn();
    useRealtimeMock.mockReturnValueOnce({
      isConnected: true,
      metrics: { open: 5, acknowledged: 3, resolved24h: 10, highUrgency: 2 },
      recentIncidents: [{ id: '1', title: 'Test Incident' }],
      error: null,
    });

    render(
      <DashboardRealtimeWrapper onIncidentsUpdate={onIncidentsUpdate}>
        <div>Test</div>
      </DashboardRealtimeWrapper>
    );

    // Component should handle incidents updates
    expect(onIncidentsUpdate).toHaveBeenCalled();
  });

  it('does not require a full refresh when updates arrive', () => {
    useRealtimeMock.mockReturnValueOnce({
      isConnected: true,
      metrics: { open: 5, acknowledged: 3, resolved24h: 10, highUrgency: 2 },
      recentIncidents: [{ id: '1', title: 'Test Incident' }],
      error: null,
    });

    render(
      <DashboardRealtimeWrapper>
        <div>Test</div>
      </DashboardRealtimeWrapper>
    );

    expect(screen.queryByRole('button', { name: /dashboard updates available/i })).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('keeps same-ID lifecycle updates on the realtime client path', () => {
    useRealtimeMock.mockReturnValue({
      isConnected: true,
      metrics: { open: 5, acknowledged: 3, resolved24h: 10, highUrgency: 2 },
      recentIncidents: [{ id: '1', status: 'OPEN', updatedAt: '2026-09-05T00:00:00Z' }],
      error: null,
    });
    const view = render(
      <DashboardRealtimeWrapper>
        <div>Test</div>
      </DashboardRealtimeWrapper>
    );
    expect(screen.queryByRole('button', { name: /dashboard updates available/i })).toBeNull();

    useRealtimeMock.mockReturnValue({
      isConnected: true,
      metrics: { open: 4, acknowledged: 4, resolved24h: 10, highUrgency: 2 },
      recentIncidents: [{ id: '1', status: 'ACKNOWLEDGED', updatedAt: '2026-09-05T00:01:00Z' }],
      error: null,
    });
    view.rerender(
      <DashboardRealtimeWrapper>
        <div>Test</div>
      </DashboardRealtimeWrapper>
    );
    expect(screen.queryByRole('button', { name: /dashboard updates available/i })).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
