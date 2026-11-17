import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsSubpageNav from '@/components/settings/SettingsSubpageNav';
import { buildSettingsBreadcrumbs } from '@/components/settings/settings-breadcrumbs';

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
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Workspace & Governance' })).toHaveAttribute(
      'href',
      '/settings#workspace'
    );
    expect(screen.getByText('Incident Response Policy')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('mock-search-trigger')).toBeInTheDocument();
  });

  it('links the page crumb and ends with the detail label on deep child routes', () => {
    currentPathname = '/settings/status-pages/cm12345';
    render(<SettingsSubpageNav currentLabel="Acme status" />);

    expect(screen.getByRole('link', { name: 'Public Status Page' })).toHaveAttribute(
      'href',
      '/settings/status-pages'
    );
    expect(screen.getByText('Acme status')).toHaveAttribute('aria-current', 'page');
  });

  it('can hide the settings search for focused flows', () => {
    currentPathname = '/settings/chatops/link';
    render(<SettingsSubpageNav currentLabel="Link Microsoft Teams" showSearch={false} />);
    expect(screen.queryByTestId('mock-search-trigger')).not.toBeInTheDocument();
  });
});

describe('buildSettingsBreadcrumbs', () => {
  it('sends the integrations section crumb to the integrations hub', () => {
    expect(buildSettingsBreadcrumbs('/settings/integrations/slack')).toEqual([
      { label: 'Settings', href: '/settings' },
      { label: 'Integrations & ChatOps', href: '/settings/integrations' },
      { label: 'Slack Workspace' },
    ]);
  });

  it('appends an explicit trail after the linked settings page', () => {
    expect(
      buildSettingsBreadcrumbs('/settings/integrations/mcp/assistants/a1', {
        trail: [
          { label: 'Assistants', href: '/settings/integrations/mcp?tab=assistants' },
          { label: 'Claude' },
        ],
      }).slice(-3)
    ).toEqual([
      { label: 'MCP (AI Assistants)', href: '/settings/integrations/mcp' },
      { label: 'Assistants', href: '/settings/integrations/mcp?tab=assistants' },
      { label: 'Claude' },
    ]);
  });

  it('prefers the longest matching settings page', () => {
    expect(buildSettingsBreadcrumbs('/settings/notifications/operations').at(-1)).toEqual({
      label: 'Notification Operations',
    });
  });
});
