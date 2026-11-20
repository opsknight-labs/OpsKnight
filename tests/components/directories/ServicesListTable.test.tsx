import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServicesListTable, { type ServiceListItem } from '@/components/service/ServicesListTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}));

const service: ServiceListItem = {
  id: 'svc1',
  name: 'Checkout API',
  description: 'Card capture',
  region: 'us-east-1',
  slaTier: 'Gold',
  dynamicStatus: 'CRITICAL',
  openIncidentCount: 2,
  hasCritical: true,
  metricDataState: 'available',
  maintenanceTitle: 'DB upgrade',
  team: { id: 't1', name: 'Payments' },
  policy: { id: 'p1', name: 'Payments EP' },
};

describe('ServicesListTable', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders the directory table with every service field', () => {
    render(
      <ServicesListTable
        services={[service]}
        canManageServices
        pagination={{ currentPage: 1, totalPages: 1, totalItems: 1, itemsPerPage: 20 }}
      />
    );
    const table = screen.getByRole('table', { name: 'Services' });
    expect(screen.getByText('Showing 1–1 of 1')).toBeTruthy();
    const t = within(table);
    expect(t.getByRole('link', { name: 'Checkout API' }).getAttribute('href')).toBe(
      '/services/svc1'
    );
    expect(t.getByText('Card capture')).toBeTruthy();
    expect(t.getByText('Critical')).toBeTruthy();
    expect(t.getByTitle('DB upgrade')).toBeTruthy();
    expect(t.getByText('Payments')).toBeTruthy();
    expect(t.getByText('2')).toBeTruthy();
    expect(t.getByRole('link', { name: 'Payments EP' }).getAttribute('href')).toBe('/policies/p1');
    expect(t.getByText('Gold')).toBeTruthy();
    expect(t.getByText('us-east-1')).toBeTruthy();
    expect(t.getByRole('button', { name: 'Actions for Checkout API' })).toBeTruthy();
  });

  it('hides row actions without manage permission and shows the empty state', () => {
    const { rerender } = render(
      <ServicesListTable services={[service]} canManageServices={false} />
    );
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
    rerender(<ServicesListTable services={[]} canManageServices={false} />);
    expect(screen.getByText('No services found')).toBeTruthy();
  });

  it('renders compact cards when the card view is remembered', () => {
    window.localStorage.setItem('opsknight:directory-view:services', 'cards');
    render(<ServicesListTable services={[service]} canManageServices />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('2 active incidents')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actions for Checkout API' })).toBeTruthy();
  });
});
