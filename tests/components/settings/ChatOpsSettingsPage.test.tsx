import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatOpsSettingsPage from '@/components/settings/ChatOpsSettingsPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const mockConfig = {
  enabled: true,
  channelPrefix: 'inc',
  autoCreateOnUrgency: ['HIGH', 'MEDIUM'],
  autoCreateOnPriority: ['P1', 'P2'],
  archiveOnResolve: true,
  defaultVideoBridge: 'JITSI',
  customBridgeUrlTemplate: null,
  updatedAt: new Date('2026-09-01T12:00:00Z'),
};

describe('ChatOpsSettingsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders neutral message when no providers are connected', () => {
    render(
      <ChatOpsSettingsPage
        config={mockConfig}
        isAdmin={true}
        providerStatus={{
          slack: { connected: false },
          teams: { connected: false, warRoomsEnabled: false, destinationsCount: 0 },
        }}
      />
    );

    expect(screen.getByText('No collaboration provider is configured yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect Slack/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Configure Teams/i })).toBeInTheDocument();
  });

  it('renders provider status cards, policy settings, video bridge, and provider capabilities table', () => {
    render(
      <ChatOpsSettingsPage
        config={mockConfig}
        isAdmin={true}
        providerStatus={{
          slack: { connected: true, workspaceName: 'OpsKnight Dev' },
          teams: { connected: true, warRoomsEnabled: true, destinationsCount: 2 },
        }}
      />
    );

    // Connected providers
    expect(screen.getByText('Connected Providers')).toBeInTheDocument();
    expect(screen.getAllByText('Slack').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Microsoft Teams').length).toBeGreaterThan(0);

    // War room policy
    expect(screen.getByText('War Room & Collaboration Policy')).toBeInTheDocument();
    expect(screen.getByLabelText(/Room Name Prefix/i)).toBeInTheDocument();
    expect(screen.getByText('Generated Name Preview')).toBeInTheDocument();
    expect(screen.getAllByText(/inc-payments-api-a82c/i).length).toBe(2);

    // Auto-creation policy

    expect(screen.getByText('Automatic Creation Rules')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(screen.getByText('P2')).toBeInTheDocument();
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);

    // Video War Room

    expect(screen.getByText('Video War Room Bridge')).toBeInTheDocument();
    expect(screen.getByText('Jitsi Meet')).toBeInTheDocument();
    expect(screen.getByText('Zoom Meeting')).toBeInTheDocument();
    expect(screen.getByText('Google Meet')).toBeInTheDocument();

    // Provider Capabilities Table
    expect(screen.getByText('Provider Capabilities')).toBeInTheDocument();
    expect(screen.getByText('Interactive ChatOps')).toBeInTheDocument();

    // Default Provider selector when both are connected
    expect(screen.getByText('Default War Room Provider')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SLACK')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MICROSOFT_TEAMS')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BOTH')).toBeInTheDocument();
  });

  it('renders static default notice when only Slack is connected', () => {
    render(
      <ChatOpsSettingsPage
        config={mockConfig}
        isAdmin={true}
        providerStatus={{
          slack: { connected: true, workspaceName: 'OpsKnight Dev' },
          teams: { connected: false, warRoomsEnabled: false, destinationsCount: 0 },
        }}
      />
    );

    expect(screen.getByText('Default War Room Provider')).toBeInTheDocument();
    expect(screen.getByText('Only Connected Provider')).toBeInTheDocument();
    expect(
      screen.getByText(/Slack is currently the only connected war room provider/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Both/i })).not.toBeInTheDocument();
  });

  it('renders static default notice when only Teams is connected', () => {
    render(
      <ChatOpsSettingsPage
        config={mockConfig}
        isAdmin={true}
        providerStatus={{
          slack: { connected: false },
          teams: { connected: true, warRoomsEnabled: true, destinationsCount: 1 },
        }}
      />
    );

    expect(screen.getByText('Default War Room Provider')).toBeInTheDocument();
    expect(screen.getByText('Only Connected Provider')).toBeInTheDocument();
    expect(
      screen.getByText(/Microsoft Teams is currently the only connected war room provider/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Both/i })).not.toBeInTheDocument();
  });
});
