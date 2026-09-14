import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsTopNav from '@/components/settings/layout/SettingsTopNav';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/integrations/slack',
  useRouter: () => ({ push: vi.fn() }),
}));

describe('SettingsTopNav', () => {
  it('renders all single-tier tabs and search trigger for admin', () => {
    render(<SettingsTopNav isAdmin={true} isAuditor={false} isResponderOrAbove={true} />);

    // Single-tier tabs
    expect(screen.getByRole('link', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^security & access$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^incident slas$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^custom fields$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^status pages$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^api keys$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^integrations$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^platform$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^audit logs$/i })).toBeInTheDocument();

    // Search trigger
    expect(screen.getByTitle(/search settings/i)).toBeInTheDocument();
  });

  it('hides admin-only tabs when user is not admin', () => {
    render(<SettingsTopNav isAdmin={false} isAuditor={false} isResponderOrAbove={false} />);

    // Non-admin accessible tabs
    expect(screen.getByRole('link', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^security & access$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^api keys$/i })).toBeInTheDocument();

    // Admin-only tabs should not be rendered
    expect(screen.queryByRole('link', { name: /^incident slas$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^custom fields$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^status pages$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^integrations$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^platform$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^audit logs$/i })).not.toBeInTheDocument();
  });
});
