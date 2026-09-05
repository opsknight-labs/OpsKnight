import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OperationalStatus from '@/components/OperationalStatus';

vi.mock('@/hooks/useOperationalStats', () => ({
  useOperationalStats: vi.fn().mockReturnValue({
    activeCount: 0,
    criticalCount: 0,
    mediumCount: 0,
    lowCount: 0,
    loading: true,
    error: null,
    hasLiveStats: false,
  }),
}));

describe('OperationalStatus', () => {
  beforeEach(() => {
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
});
