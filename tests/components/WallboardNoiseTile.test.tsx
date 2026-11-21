import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WallboardNoiseTile from '@/components/dashboard/live/WallboardNoiseTile';

const on = {
  state: 'on' as const,
  shadowOnly: false,
  days: 1,
  pagesAvoided: 1234,
  shadowWouldAvoid: 5,
  compressionRatio: 3.4,
  grouped: 40,
  falseGroupPercent: 2.5,
  heartbeatsMissing: 1,
};

describe('WallboardNoiseTile', () => {
  it('shows the noise KPIs', () => {
    render(<WallboardNoiseTile tile={on} />);
    expect(screen.getByRole('heading', { name: 'Noise reduction' })).toBeInTheDocument();
    expect(screen.getByText('Pages avoided')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('+5 in shadow')).toBeInTheDocument();
    expect(screen.getByText('3.4×')).toBeInTheDocument();
    expect(screen.getByText('2.5% ungrouped')).toBeInTheDocument();
  });

  it('reports what shadow mode would avoid when nothing is ON yet', () => {
    render(<WallboardNoiseTile tile={{ ...on, shadowOnly: true, shadowWouldAvoid: 77 }} />);
    expect(screen.getByText('Would avoid (shadow)')).toBeInTheDocument();
    expect(screen.getByText('77')).toBeInTheDocument();
  });

  it('tells only administrators where to turn noise controls on', () => {
    const { unmount } = render(<WallboardNoiseTile tile={{ state: 'off', canManage: true }} />);
    expect(screen.getByRole('link', { name: 'Intelligence › Noise controls' })).toHaveAttribute(
      'href',
      '/settings/intelligence/noise-controls'
    );
    unmount();
    render(<WallboardNoiseTile tile={{ state: 'off', canManage: false }} />);
    expect(screen.getByText(/Noise controls are off/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
