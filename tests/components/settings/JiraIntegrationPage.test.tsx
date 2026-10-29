import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import JiraIntegrationPage from '@/components/settings/JiraIntegrationPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const mockConfig = {
  baseUrl: 'https://acme.atlassian.net',
  userEmail: 'ops@acme.com',
  enabled: true,
  webhookSecretEncrypted: 'enc-secret-xyz',
  updatedAt: new Date('2026-09-01T12:00:00Z'),
  updatedByUser: {
    name: 'Alice Admin',
    email: 'alice@acme.com',
  },
};

describe('JiraIntegrationPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders workspace lifecycle plus the three configuration cards', () => {
    render(<JiraIntegrationPage config={mockConfig} isAdmin={true} />);

    expect(screen.getByText('Jira Workspace')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Enable Jira integration/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /Remove Jira Workspace/i })).toBeInTheDocument();

    // Card 1: Workspace Credentials
    expect(screen.getByText('Workspace Credentials')).toBeInTheDocument();
    expect(screen.getByLabelText(/Jira Site URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Service Account Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Atlassian API Token/i)).toBeInTheDocument();
    expect(screen.getByText('AES-256 Encrypted')).toBeInTheDocument();

    // Card 2: Inbound Webhook Sync
    expect(screen.getByText('Inbound Webhook Sync')).toBeInTheDocument();
    expect(screen.getByText('Jira Cloud Webhook URL')).toBeInTheDocument();
    expect(screen.getByText('OpsKnight Webhook Endpoint')).toBeInTheDocument();
    expect(screen.getByText('Copy URL')).toBeInTheDocument();

    // Card 3: Connection Diagnostics
    expect(screen.getByText('Connection Diagnostics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Test Connection/i })).toBeInTheDocument();

    // Sticky Action Bar
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
  });

  it('renders configured values inside inputs', () => {
    render(<JiraIntegrationPage config={mockConfig} isAdmin={true} />);

    expect(screen.getByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ops@acme.com')).toBeInTheDocument();
  });

  it('requires an explicit destructive confirmation before workspace removal', () => {
    render(<JiraIntegrationPage config={mockConfig} isAdmin={true} />);

    fireEvent.click(screen.getByRole('button', { name: /Remove Jira Workspace/i }));

    const confirmInput = screen.getByLabelText(/Type REMOVE JIRA to confirm/i);
    const removeButton = screen.getByRole('button', { name: /Permanently Remove Jira/i });
    expect(removeButton).toBeDisabled();

    fireEvent.change(confirmInput, { target: { value: 'REMOVE JIRA' } });
    expect(removeButton).toBeEnabled();
    expect(screen.getByText(/Jira issues in Atlassian are/i)).toBeInTheDocument();
  });

  it('starts an unconfigured workspace cleanly disabled with no false dirty state', () => {
    render(<JiraIntegrationPage config={null} isAdmin={true} />);

    expect(screen.getByText('Not Configured')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Enable Jira integration/i })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Remove Jira Workspace/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDisabled();
  });
});
