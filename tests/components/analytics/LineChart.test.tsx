import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LineChart from '@/components/analytics/LineChart';

describe('LineChart no-data semantics', () => {
  it('renders null points as gaps instead of zero-valued points', () => {
    const { container } = render(
      <LineChart
        data={[
          { label: 'Mon', value: 20 },
          { label: 'Tue', value: null },
          { label: 'Wed', value: 30 },
        ]}
        lines={[{ key: 'value', color: '#000', label: 'MTTA' }]}
      />
    );

    const linePaths = [...container.querySelectorAll('path[fill="none"]')];
    expect(linePaths).toHaveLength(2);
    expect(linePaths.every(path => !path.getAttribute('d')?.includes(',100'))).toBe(true);
  });
});
