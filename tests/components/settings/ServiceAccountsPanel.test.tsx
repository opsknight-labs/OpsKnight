import { issuableScopesForRole } from '@/lib/api-scope-registry';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServiceAccountsPanel, { type ServiceAccountItem } from '@/components/settings/ServiceAccountsPanel';
import {
  issueServiceAccountTokenAction,
  deleteServiceAccountAction,
  revokeServiceAccountTokenAction,
} from '@/app/(app)/settings/actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock('@/app/(app)/settings/actions', () => ({
  createServiceAccountAction: vi.fn().mockResolvedValue({ success: true }),
  issueServiceAccountTokenAction: vi.fn().mockResolvedValue({ success: true, token: 'ok_live_test_token' }),
  deleteServiceAccountAction: vi.fn().mockResolvedValue(undefined),
  revokeServiceAccountTokenAction: vi.fn().mockResolvedValue(undefined),
}));

const mockAccounts: ServiceAccountItem[] = [
  {
    id: 'sa-1',
    name: 'CI/CD Automation Bot',
    email: 'sa-cicd@serviceaccount.opsknight.local',
    role: 'ADMIN',
    status: 'ACTIVE',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    teams: [{ id: 'team-infra', name: 'Infrastructure' }],
    activeTokensCount: 2,
    tokens: [
      {
        id: 'tok-1',
        name: 'GitHub Actions Main Token',
        prefix: 'ok_live_gh1',
        scopes: ['incidents:read', 'incidents:write'],
        createdAt: '2026-09-01T10:05:00Z',
        lastUsedAt: '2026-10-12T14:00:00Z',
        expiresAt: null,
      },
      {
        id: 'tok-2',
        name: 'Deploy Key',
        prefix: 'ok_live_dp2',
        scopes: ['services:read'],
        createdAt: '2026-09-02T10:00:00Z',
        lastUsedAt: null,
        expiresAt: '2026-12-31T23:59:59Z',
      },
    ],
  },
  {
    id: 'sa-2',
    name: 'Pager Monitoring Relay',
    email: 'sa-pager@serviceaccount.opsknight.local',
    role: 'RESPONDER',
    status: 'ACTIVE',
    createdAt: '2026-09-10T11:00:00Z',
    updatedAt: '2026-09-10T11:00:00Z',
    teams: [{ id: 'team-ops', name: 'SRE Team' }],
    activeTokensCount: 1,
    tokens: [
      {
        id: 'tok-3',
        name: 'Alert Ingest Key',
        prefix: 'ok_live_al3',
        scopes: ['events:write'],
        createdAt: '2026-09-10T11:05:00Z',
        lastUsedAt: '2026-10-14T08:00:00Z',
        expiresAt: null,
      },
    ],
  },
];

const mockTeams = [
  { id: 'team-infra', name: 'Infrastructure' },
  { id: 'team-ops', name: 'SRE Team' },
];

describe('ServiceAccountsPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders service accounts with name, email, role, and active token count', () => {
    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    expect(screen.getByText('CI/CD Automation Bot')).toBeDefined();
    expect(screen.getByText('sa-cicd@serviceaccount.opsknight.local')).toBeDefined();
    expect(screen.getByText('Pager Monitoring Relay')).toBeDefined();
    expect(screen.getByText('sa-pager@serviceaccount.opsknight.local')).toBeDefined();
    expect(screen.getByText(/2 active tokens/i)).toBeDefined();
    expect(screen.getByText(/1 active token/i)).toBeDefined();
  });

  it('shows create button when isAdmin is true and hides when isAdmin is false', () => {
    const { rerender } = render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    expect(screen.getByText('New Service Account')).toBeDefined();

    rerender(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={false}
      />
    );

    expect(screen.queryByText('New Service Account')).toBeNull();
  });

  it('filters service accounts by search query', () => {
    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search service accounts by name or email/i);
    fireEvent.change(searchInput, { target: { value: 'Pager' } });

    expect(screen.getByText('Pager Monitoring Relay')).toBeDefined();
    expect(screen.queryByText('CI/CD Automation Bot')).toBeNull();
  });

  it('displays empty state when no accounts match search filter', () => {
    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search service accounts by name or email/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent-bot' } });

    expect(screen.getByText(/no matching service accounts/i)).toBeDefined();
  });

  it('expands account details to show issued tokens', () => {
    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    // Expand the first service account
    const viewTokensButton = screen.getByText('View Tokens (2)');
    fireEvent.click(viewTokensButton);

    expect(screen.getByText('GitHub Actions Main Token')).toBeDefined();
    expect(screen.getByText('ok_live_gh1...')).toBeDefined();
    expect(screen.getByText('Deploy Key')).toBeDefined();
    expect(screen.getByText('ok_live_dp2...')).toBeDefined();
  });

  it('opens create service account dialog when clicking New Service Account', () => {
    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    const createButton = screen.getByText('New Service Account');
    fireEvent.click(createButton);

    expect(screen.getByText('Create Service Account')).toBeDefined();
    expect(
      screen.getByPlaceholderText(/e\.g\., CI\/CD GitHub Runner or Terraform Operator/i)
    ).toBeDefined();
  });

  it('opens issue token dialog and switches scope presets', () => {
    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    const issueButtons = screen.getAllByRole('button', { name: /issue token/i });
    fireEvent.click(issueButtons[0]);

    expect(screen.getByText('Issue Service Account Token')).toBeDefined();
    expect(screen.getByLabelText(/token name \/ label \*/i)).toBeDefined();
    expect(screen.getByLabelText(/expiration duration/i)).toBeDefined();

    // Counts come from the registry: the account is an ADMIN, so every active scope is offered
    // and reserved scopes (which grant nothing) are not.
    const offered = issuableScopesForRole('ADMIN');
    const total = offered.length;
    expect(offered.some(definition => definition.status === 'reserved')).toBe(false);
    expect(screen.getByText(new RegExp(`of ${total} scopes`, 'i'))).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Admin Full' }));
    expect(screen.getByText(new RegExp(`selected: ${total} of ${total} scopes`, 'i'))).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText(new RegExp(`selected: 0 of ${total} scopes`, 'i'))).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Read-Only' }));
    const readOnly = offered.filter(definition => !definition.write).length;
    expect(
      screen.getByText(new RegExp(`selected: ${readOnly} of ${total} scopes`, 'i'))
    ).toBeDefined();
  });

  it('submits issue token form and displays revealed token banner', async () => {
    vi.mocked(issueServiceAccountTokenAction).mockResolvedValue({
      success: true,
      token: 'ok_live_test_revealed_token_999',
    });

    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: /issue token/i })[0]);

    const nameInput = screen.getByLabelText(/token name \/ label \*/i);
    fireEvent.change(nameInput, { target: { value: 'Nightly Backup Runner' } });

    const submitBtn = screen.getByRole('button', { name: 'Issue Token' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(issueServiceAccountTokenAction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('Service Account Access Token Issued')).toBeDefined();
      expect(screen.getByText('ok_live_test_revealed_token_999')).toBeDefined();
    });
  });

  it('opens revoke token dialog and confirms revocation', async () => {
    vi.mocked(revokeServiceAccountTokenAction).mockResolvedValue(undefined);

    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    // Expand tokens
    fireEvent.click(screen.getByText('View Tokens (2)'));
    expect(screen.getByText('GitHub Actions Main Token')).toBeDefined();

    // Click revoke on the first token
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' });
    fireEvent.click(revokeButtons[0]);

    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByText('Revoke Access Token?')).toBeDefined();
    expect(
      screen.getByText(/are you sure you want to revoke 'github actions main token'\?/i)
    ).toBeDefined();

    // Confirm revocation
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Token' }));

    await waitFor(() => {
      expect(revokeServiceAccountTokenAction).toHaveBeenCalledTimes(1);
    });

    const formData = vi.mocked(revokeServiceAccountTokenAction).mock.calls[0][0] as FormData;
    expect(formData.get('serviceAccountId')).toBe('sa-1');
    expect(formData.get('tokenId')).toBe('tok-1');
  });

  it('displays error in revoke dialog when revocation fails', async () => {
    vi.mocked(revokeServiceAccountTokenAction).mockRejectedValueOnce(
      new Error('Failed to revoke machine token due to network error')
    );

    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    fireEvent.click(screen.getByText('View Tokens (2)'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Token' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to revoke machine token due to network error')).toBeDefined();
    });
  });

  it('opens delete account dialog and confirms deletion', async () => {
    vi.mocked(deleteServiceAccountAction).mockResolvedValue(undefined);

    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    // Click delete on CI/CD Automation Bot
    const deleteBtn = screen.getByRole('button', { name: 'Delete CI/CD Automation Bot' });
    fireEvent.click(deleteBtn);

    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByText('Delete Service Account?')).toBeDefined();
    expect(
      screen.getByText(
        /this will deactivate the service account and permanently revoke all of its issued tokens/i
      )
    ).toBeDefined();

    // Confirm delete
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));

    await waitFor(() => {
      expect(deleteServiceAccountAction).toHaveBeenCalledTimes(1);
    });

    const formData = vi.mocked(deleteServiceAccountAction).mock.calls[0][0] as FormData;
    expect(formData.get('serviceAccountId')).toBe('sa-1');
  });

  it('displays error in delete dialog when deletion fails', async () => {
    vi.mocked(deleteServiceAccountAction).mockRejectedValueOnce(
      new Error('Database lock error during deletion')
    );

    render(
      <ServiceAccountsPanel
        serviceAccounts={mockAccounts}
        availableTeams={mockTeams}
        isAdmin={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete CI/CD Automation Bot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));

    await waitFor(() => {
      expect(screen.getByText('Database lock error during deletion')).toBeDefined();
    });
  });
});
