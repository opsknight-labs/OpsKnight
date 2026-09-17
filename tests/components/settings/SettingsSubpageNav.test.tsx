import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsSubpageNav from '@/components/settings/SettingsSubpageNav';

let currentPathname = '/settings/incident-sla';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

vi.mock('@/components/settings/SettingsSearchTrigger', () => ({
  default: () => <button data-testid="mock-search-trigger">Search</button>,
}));

describe('SettingsSubpageNav', () => {
  it('returns null on /settings root overview page', () => {
    currentPathname = '/settings';
    const { container } = render(<SettingsSubpageNav />);
    expect(container.firstChild).toBeNull();
  });

  it('renders section and page title breadcrumbs on a standard settings subpage', () => {
    currentPathname = '/settings/incident-sla';
    render(<SettingsSubpageNav />);

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByText('Workspace & Governance')).toBeInTheDocument();
    expect(screen.getByText('Incident Response Policy')).toBeInTheDocument();
    expect(screen.getByTestId('mock-search-trigger')).toBeInTheDocument();
  });

  it('renders parent link and Detail for deep child routes', () => {
    currentPathname = '/settings/status-pages/cm12345';
    render(<SettingsSubpageNav />);

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByText('Workspace & Governance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Public Status Page' })).toHaveAttribute(
      'href',
      '/settings/status-pages'
    );
    expect(screen.getByText('Detail')).toBeInTheDocument();
  });
});
