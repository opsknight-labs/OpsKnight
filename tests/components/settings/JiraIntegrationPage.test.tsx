import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('renders all three modern cards and fields properly', () => {
    render(<JiraIntegrationPage config={mockConfig} isAdmin={true} />);

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
});
