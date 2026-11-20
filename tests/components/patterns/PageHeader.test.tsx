import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Server } from 'lucide-react';
import PageHeader from '@/components/patterns/PageHeader';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';

describe('PageHeader', () => {
  it('renders the house dark header with title, description, icon tile and ordered actions', () => {
    const { container } = render(
      <PageHeader
        title="Services"
        description="Monitor service health."
        icon={Server}
        secondaryActions={<button type="button">Export</button>}
        primaryAction={<button type="button">New service</button>}
        stats={[{ label: 'Total', value: 12 }]}
      />
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Services' })).toBeInTheDocument();
    expect(screen.getByText('Monitor service health.')).toBeInTheDocument();
    expect(container.querySelector('.ok-inverse-surface')).not.toBeNull();
    expect(container.querySelector('svg.lucide-server')).not.toBeNull();
    const buttons = screen.getAllByRole('button').map(b => b.textContent);
    expect(buttons).toEqual(['Export', 'New service']);
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders breadcrumb items as an accessible trail with the current page last', () => {
    render(
      <PageHeader
        title="Compare"
        breadcrumbs={[{ label: 'Runbooks', href: '/runbooks' }, { label: 'Compare' }]}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Runbooks' })).toHaveAttribute(
      'href',
      '/runbooks'
    );
    expect(within(nav).getByText('Compare')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps RunbookPageHeader props working on top of PageHeader', () => {
    render(
      <RunbookPageHeader
        title="Version comparison"
        breadcrumbs={[{ label: 'Runbooks', href: '/runbooks' }, { label: 'Compare' }]}
        badge={<span>v1 → v2</span>}
        actions={<button type="button">Back to runbook</button>}
      />
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Version comparison' })
    ).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('v1 → v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to runbook' })).toBeInTheDocument();
  });
});
