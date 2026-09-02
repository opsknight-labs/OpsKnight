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

  it('renders Slack disconnected warning when Slack is not connected', () => {
    render(<ChatOpsSettingsPage config={mockConfig} isAdmin={true} isSlackConnected={false} />);

    expect(screen.getByText('Slack Integration Not Connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect Slack Integration/i })).toBeInTheDocument();
  });

  it('renders all cards and live simulation when Slack is connected', () => {
    render(<ChatOpsSettingsPage config={mockConfig} isAdmin={true} isSlackConnected={true} />);

    // Slack connection banner
    expect(screen.getByText('Slack Bot Integration Connected')).toBeInTheDocument();

    // Card 1: Channel automation and live simulation pill
    expect(screen.getByText('Incident Channel Automation')).toBeInTheDocument();
    expect(screen.getByLabelText(/Slack Channel Prefix/i)).toBeInTheDocument();
    expect(screen.getByText('Live Channel Name Simulation')).toBeInTheDocument();
    expect(screen.getByText(/inc-402-database-latency/i)).toBeInTheDocument();

    // Card 2: Auto-creation triggers
    expect(screen.getByText('Auto-Creation Triggers')).toBeInTheDocument();
    expect(screen.getByText(/Auto-Create on Incident Priority/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-Create on Incident Urgency/i)).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(screen.getByText('P2')).toBeInTheDocument();
    expect(screen.getByText('High Urgency')).toBeInTheDocument();

    // Card 3: Video War Room
    expect(screen.getByText('Video War Room Bridge')).toBeInTheDocument();
    expect(screen.getByText('Jitsi Meet')).toBeInTheDocument();
    expect(screen.getByText('Zoom Meeting')).toBeInTheDocument();
    expect(screen.getByText('Google Meet')).toBeInTheDocument();

    // Sticky Action Bar
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
  });
});
