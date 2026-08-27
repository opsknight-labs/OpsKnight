import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MetricCard from '@/components/dashboard/MetricCard';

describe('MetricCard', () => {
  it('shows an operational breakdown and links to the matching incident filter', () => {
    render(
      <MetricCard
        label="ACTIVE"
        value={396}
        description="187 Triggered · 209 Acknowledged"
        href="/incidents?filter=all_open"
        variant="hero"
      />
    );

    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('187 Triggered · 209 Acknowledged')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View active incidents' });
    expect(link).toHaveAttribute('href', '/incidents?filter=all_open');
    expect(link).toHaveClass('h-full');
    expect(screen.getByRole('figure')).toHaveClass('h-full', 'min-h-32');
  });

  it('shows the muted breakdown and links to the combined muted filter', () => {
    render(
      <MetricCard
        label="MUTED"
        value={118}
        description="75 Snoozed · 43 Suppressed"
        href="/incidents?filter=muted"
        variant="hero"
      />
    );

    expect(screen.getByText('MUTED')).toBeInTheDocument();
    expect(screen.getByText('75 Snoozed · 43 Suppressed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View muted incidents' })).toHaveAttribute(
      'href',
      '/incidents?filter=muted'
    );
  });

  it('does not present an aggregation failure as a healthy zero', () => {
    render(
      <MetricCard
        label="ACTIVE"
        value={0}
        variant="hero"
        dataState="unavailable"
        tooltip="Current actionable backlog"
      />
    );

    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Data unavailable');
    expect(screen.getByRole('figure')).toHaveAttribute('title', 'Current actionable backlog');
  });

  it('distinguishes no qualifying data from a measured zero', () => {
    render(<MetricCard label="MTTR" value={0} dataState="no_data" />);

    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No qualifying data');
  });
});
