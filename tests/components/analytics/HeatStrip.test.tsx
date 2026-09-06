import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import HeatStrip from '@/components/analytics/HeatStrip';

describe('HeatStrip', () => {
  it('renders cells and axis labels', () => {
    const data = [
      { key: 'd1', label: 'Jan 1', count: 2 },
      { key: 'd2', label: 'Jan 2', count: 5 },
      { key: 'd3', label: 'Jan 3', count: 1 },
    ];

    const { container } = render(<HeatStrip data={data} maxValue={5} height={20} />);

    const cells = container.querySelectorAll('.analytics-heat-strip-cell');
    expect(cells.length).toBe(3);

    expect(screen.getByText('Jan 1')).toBeInTheDocument();
    expect(screen.getByText('Jan 3')).toBeInTheDocument();
  });
});
