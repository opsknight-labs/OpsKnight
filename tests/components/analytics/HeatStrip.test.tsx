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

describe('HeatStrip (self-contained)', () => {
  it('names the strip with its total and lays out one column per day', () => {
    const data = [
      { key: 'a', label: 'Nov 1', count: 1 },
      { key: 'b', label: 'Nov 2', count: 3 },
    ];
    const { container } = render(<HeatStrip data={data} maxValue={3} label="Pages per day" />);
    expect(
      screen.getByRole('img', { name: 'Pages per day: 4 from Nov 1 to Nov 2' })
    ).toBeInTheDocument();
    const row = container.querySelector('.analytics-heat-strip-row') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });
});
