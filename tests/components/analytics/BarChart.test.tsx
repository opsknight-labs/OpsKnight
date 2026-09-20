import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BarChart from '@/components/analytics/BarChart';

describe('BarChart', () => {
  it('preserves missing values instead of rendering a zero bar', () => {
    const { container } = render(
      <BarChart
        data={[
          { key: 'missing', label: 'Monday', count: null },
          { key: 'zero', label: 'Tuesday', count: 0 },
        ]}
        maxValue={10}
        showValues
      />
    );

    const bars = container.querySelectorAll('.analytics-bar-fill-enhanced');
    expect(bars[0]).toHaveAttribute('title', 'Monday: No data');
    expect(bars[0]).toHaveAttribute('data-no-data', 'true');
    expect(bars[0]).toHaveStyle({ height: '0%' });
    expect(bars[1]).toHaveAttribute('title', 'Tuesday: 0');
    expect(bars[1]).not.toHaveAttribute('data-no-data');
  });
});
