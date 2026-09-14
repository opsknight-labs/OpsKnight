import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OperationalStatus from '@/components/OperationalStatus';

const mockRealtimeMetrics = vi.hoisted(() => ({
  current: null as {
    open: number;
    acknowledged: number;
    resolved24h: number;
    highUrgency: number;
    mediumUrgency?: number;
    lowUrgency?: number;
    active?: number;
  } | null,
}));

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => ({
    isConnected: true,
    metrics: mockRealtimeMetrics.current,
    recentIncidents: [],
    error: null,
  }),
  useOptionalRealtime: () => ({
    isConnected: true,
    metrics: mockRealtimeMetrics.current,
    recentIncidents: [],
    error: null,
  }),
}));

describe('OperationalStatus', () => {
  beforeEach(() => {
    mockRealtimeMetrics.current = null;
    vi.clearAllMocks();
  });

  it('renders synchronously with initial props on SSR/first paint without returning null', () => {
    render(
      <OperationalStatus
        tone="danger"
        label="Red Alert"
        detail="2 critical incidents active"
        criticalCount={2}
        mediumCount={1}
        lowCount={0}
      />
    );

    // Should render the label immediately without mounting delay
    expect(screen.getByText('Red Alert')).toBeInTheDocument();
    expect(screen.getByText(/H 2 · M 1 · L 0/i)).toBeInTheDocument();
  });

  it('renders green corridor when counts are zero', () => {
    render(
      <OperationalStatus
        tone="ok"
        label="Green Corridor"
        detail="All systems fully operational"
        criticalCount={0}
        mediumCount={0}
        lowCount={0}
      />
    );

    expect(screen.getByText('Green Corridor')).toBeInTheDocument();
    expect(screen.getByText(/H 0 · M 0 · L 0/i)).toBeInTheDocument();
  });

  it('updates dynamically from RealtimeProvider metrics without HTTP polling', () => {
    mockRealtimeMetrics.current = {
      open: 5,
      acknowledged: 2,
      resolved24h: 10,
      highUrgency: 3,
      mediumUrgency: 4,
      lowUrgency: 1,
      active: 8,
    };

    render(
      <OperationalStatus
        tone="ok"
        label="Green Corridor"
        detail="All systems fully operational"
        criticalCount={0}
        mediumCount={0}
        lowCount={0}
      />
    );

    expect(screen.getByText(/H 3 · M 4 · L 1/i)).toBeInTheDocument();
    expect(screen.getByText('Critical Alert')).toBeInTheDocument();
  });
});
