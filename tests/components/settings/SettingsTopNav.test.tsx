import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsTopNav from '@/components/settings/layout/SettingsTopNav';

let mockPathname = '/settings/integrations/slack';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn() }),
}));

describe('SettingsTopNav', () => {
  beforeEach(() => {
    mockPathname = '/settings/integrations/slack';
  });

  it('renders core primary tabs, More dropdown trigger, and search trigger for admin', async () => {
    render(<SettingsTopNav isAdmin={true} isAuditor={false} isResponderOrAbove={true} />);

    // Core primary tabs
    expect(screen.getByRole('link', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^security & access$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^compliance$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^incident slas$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^integrations$/i })).toBeInTheDocument();

    // More dropdown trigger
    const moreBtn = screen.getByRole('button', { name: /more/i });
    expect(moreBtn).toBeInTheDocument();

    // Click More to reveal secondary tabs
    fireEvent.pointerDown(moreBtn, { button: 0 });
    expect(await screen.findByRole('menuitem', { name: /custom fields/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /status pages/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /api keys/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /platform/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /audit logs/i })).toBeInTheDocument();

    // Search trigger
    expect(screen.getByTitle(/search settings/i)).toBeInTheDocument();
  });

  it('promotes active secondary tab to visible row when navigating to it', () => {
    mockPathname = '/settings/status-pages';
    render(<SettingsTopNav isAdmin={true} isAuditor={false} isResponderOrAbove={true} />);

    // Status Pages should be promoted to primary visible links
    expect(screen.getByRole('link', { name: /^status pages$/i })).toBeInTheDocument();
  });

  it('hides admin-only tabs when user is not admin', () => {
    render(<SettingsTopNav isAdmin={false} isAuditor={false} isResponderOrAbove={false} />);

    // Non-admin accessible core tabs
    expect(screen.getByRole('link', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^security & access$/i })).toBeInTheDocument();

    // Admin-only tabs should not be rendered
    expect(screen.queryByRole('link', { name: /^compliance$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^incident slas$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^integrations$/i })).not.toBeInTheDocument();
  });
});
