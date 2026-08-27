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
    expect(screen.getByRole('link', { name: 'View active incidents' })).toHaveAttribute(
      'href',
      '/incidents?filter=all_open'
    );
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
});
