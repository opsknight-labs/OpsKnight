import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApiKeysWorkspaceTabs from '@/components/settings/ApiKeysWorkspaceTabs';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/api-keys',
  useSearchParams: () => new URLSearchParams(''),
}));

describe('ApiKeysWorkspaceTabs Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 4 tabs with accurate labels and counts', () => {
    render(
      <ApiKeysWorkspaceTabs
        initialTab="api-keys"
        totalKeys={5}
        totalServiceAccounts={3}
        endpointCount={63}
        isAdmin={true}
        apiKeysContent={<div data-testid="api-keys-content">API Keys Content</div>}
        serviceAccountsContent={<div data-testid="service-accounts-content">Service Accounts Content</div>}
        explorerContent={<div data-testid="explorer-content">Explorer Content</div>}
        activityContent={<div data-testid="activity-content">Activity Content</div>}
      />
    );

    expect(screen.getByRole('tab', { name: /api keys \(5\)/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /service accounts \(3\)/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /api explorer \(63\)/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /api activity/i })).toBeDefined();

    expect(screen.getByTestId('api-keys-content')).toBeDefined();
  });

  it('switches tabs instantaneously without network errors', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(
      <ApiKeysWorkspaceTabs
        initialTab="api-keys"
        totalKeys={5}
        totalServiceAccounts={3}
        endpointCount={63}
        isAdmin={true}
        apiKeysContent={<div data-testid="api-keys-content">API Keys Content</div>}
        serviceAccountsContent={<div data-testid="service-accounts-content">Service Accounts Content</div>}
        explorerContent={<div data-testid="explorer-content">Explorer Content</div>}
        activityContent={<div data-testid="activity-content">Activity Content</div>}
      />
    );

    const explorerTab = screen.getByRole('tab', { name: /api explorer/i });
    fireEvent.click(explorerTab);

    expect(screen.getByTestId('explorer-content')).toBeDefined();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/settings/api-keys?tab=explorer');
  });

  it('shallowly removes ?tab when switching back to default api-keys tab', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(
      <ApiKeysWorkspaceTabs
        initialTab="explorer"
        totalKeys={5}
        totalServiceAccounts={3}
        endpointCount={63}
        isAdmin={true}
        apiKeysContent={<div data-testid="api-keys-content">API Keys Content</div>}
        serviceAccountsContent={<div data-testid="service-accounts-content">Service Accounts Content</div>}
        explorerContent={<div data-testid="explorer-content">Explorer Content</div>}
        activityContent={<div data-testid="activity-content">Activity Content</div>}
      />
    );

    const apiKeysTab = screen.getByRole('tab', { name: /api keys/i });
    fireEvent.click(apiKeysTab);

    expect(screen.getByTestId('api-keys-content')).toBeDefined();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/settings/api-keys');
  });
});
