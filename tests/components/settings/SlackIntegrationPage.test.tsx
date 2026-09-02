import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SlackIntegrationPage from '@/components/settings/SlackIntegrationPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const integrationFixture = {
  id: 'integration-1',
  workspaceId: 'T123',
  workspaceName: 'OpsKnight HQ',
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  scopes: ['chat:write', 'channels:read', 'channels:join'],
  installer: {
    id: 'user-1',
    name: 'Alex Admin',
    email: 'alex@example.com',
  },
};

describe('SlackIntegrationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ channels: [] }),
    } as unknown as Response);
  });

  it('renders setup wizard trigger when OAuth is not configured', () => {
    render(
      <SlackIntegrationPage
        integration={null}
        isOAuthConfigured={false}
        isSigningSecretConfigured={false}
        isAdmin={true}
      />
    );

    expect(screen.getByText('Connect Your Slack Workspace')).toBeInTheDocument();
    expect(
      screen.getByText('Slack OAuth must be configured first. Use the setup wizard above.')
    ).toBeInTheDocument();
  });

  it('renders integration status and channels when connected', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        channels: [
          { id: 'C1', name: 'alerts', isPrivate: false, isMember: true },
          { id: 'C2', name: 'oncall', isPrivate: true, isMember: false },
        ],
      }),
    } as unknown as Response);

    render(
      <SlackIntegrationPage
        integration={integrationFixture}
        isOAuthConfigured={true}
        isSigningSecretConfigured={true}
        isAdmin={true}
      />
    );

    expect(await screen.findByText('alerts')).toBeInTheDocument();
    expect(screen.getAllByText('OpsKnight HQ')[0]).toBeInTheDocument();
    expect(screen.getAllByText(/connected/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Replace Workspace')).toBeInTheDocument();
    expect(screen.getByText('Scope Checklist')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    expect(screen.getByText('App Manifest & Webhook URLs')).toBeInTheDocument();
    expect(screen.getByText('Event Subscriptions URL')).toBeInTheDocument();
    expect(screen.getByText('Slack Signing Secret')).toBeInTheDocument();
  });

  it('renders signing secret card and allows rotation', async () => {
    render(
      <SlackIntegrationPage
        integration={integrationFixture}
        isOAuthConfigured={true}
        isSigningSecretConfigured={false}
        isAdmin={true}
      />
    );

    expect(screen.getByText('Slack Signing Secret')).toBeInTheDocument();
    expect(screen.getByText('Secret Missing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste 32-character Signing Secret/i)).toBeInTheDocument();
  });
});
