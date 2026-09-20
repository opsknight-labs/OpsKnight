import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GaugeChart from '@/components/analytics/GaugeChart';

describe('GaugeChart', () => {
  it('renders a neutral no-data state without a value arc', () => {
    const { container } = render(<GaugeChart value={null} label="Ack SLA" />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.querySelector('.analytics-gauge-arc')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders an evaluated percentage and value arc', () => {
    const { container } = render(<GaugeChart value={92} label="Ack SLA" />);

    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(container.querySelector('.analytics-gauge-arc')).toBeInTheDocument();
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
  });
});
