import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsTopNav from '@/components/settings/layout/SettingsTopNav';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/integrations/slack',
  useRouter: () => ({ push: vi.fn() }),
}));

describe('SettingsTopNav', () => {
  it('renders all domain tabs and contextual integration sub-pills for admin', () => {
    render(<SettingsTopNav isAdmin={true} isAuditor={false} isResponderOrAbove={true} />);

    // Primary domain tabs
    expect(screen.getByRole('link', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^account$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^workspace$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^integrations$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^platform$/i })).toBeInTheDocument();

    // Contextual sub-pills for integrations (active domain)
    expect(screen.getByRole('link', { name: /slack workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /microsoft teams/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /chatops war-rooms/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /jira issue tracking/i })).toBeInTheDocument();

    // Search trigger
    expect(screen.getByTitle(/search settings/i)).toBeInTheDocument();
  });

  it('hides admin-only domain tabs when user is not admin', () => {
    render(<SettingsTopNav isAdmin={false} isAuditor={false} isResponderOrAbove={false} />);

    // Overview, Account, and Workspace are visible
    expect(screen.getByRole('link', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^account$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^workspace$/i })).toBeInTheDocument();

    // Integrations and Platform require admin
    expect(screen.queryByRole('link', { name: /^integrations$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^platform$/i })).not.toBeInTheDocument();
  });
});
