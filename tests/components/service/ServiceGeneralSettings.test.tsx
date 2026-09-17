import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ServiceGeneralSettings from '@/components/service/ServiceGeneralSettings';

describe('ServiceGeneralSettings', () => {
  const mockAction = vi.fn();

  const defaultService = {
    id: 'svc-general-1',
    name: 'Authentication Core',
    description: 'Handles user authentication and SSO tokens',
    region: 'us-east-1',
    slaTier: 'Platinum',
    teamId: 'team-1',
    escalationPolicyId: 'policy-1',
  };

  const mockTeams = [
    { id: 'team-1', name: 'Platform Engineering' },
    { id: 'team-2', name: 'Security Operations' },
  ];

  const mockPolicies = [
    { id: 'policy-1', name: 'Tier 1 Critical Escalation' },
    { id: 'policy-2', name: 'Standard Business Hours' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with initial service values and active tier badge', () => {
    render(
      <ServiceGeneralSettings
        service={defaultService}
        teams={mockTeams}
        policies={mockPolicies}
        canManageService={true}
        action={mockAction}
      />
    );

    expect(screen.getByText('General Configuration')).toBeInTheDocument();
    expect(screen.getByText('Platinum Tier')).toBeInTheDocument();
    expect(screen.getByLabelText(/service name/i)).toHaveValue('Authentication Core');
    expect(screen.getByLabelText(/description/i)).toHaveValue(
      'Handles user authentication and SSO tokens'
    );
    expect(screen.getByLabelText(/owning team/i)).toHaveValue('team-1');
    expect(screen.getByLabelText(/default escalation policy/i)).toHaveValue('policy-1');
    expect(screen.getByLabelText(/primary region/i)).toHaveValue('us-east-1');

    // Save button should be disabled when not dirty
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('renders all 5 SLA tier options with details', () => {
    render(
      <ServiceGeneralSettings
        service={defaultService}
        teams={mockTeams}
        policies={mockPolicies}
        canManageService={true}
        action={mockAction}
      />
    );

    expect(screen.getByText('Platinum')).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('Silver')).toBeInTheDocument();
    expect(screen.getByText('Bronze')).toBeInTheDocument();
    expect(screen.getByText('Internal')).toBeInTheDocument();

    expect(screen.getByText('99.99%')).toBeInTheDocument();
    expect(screen.getByText('15m Ack SLA')).toBeInTheDocument();
  });

  it('enables Save button when changing service name', () => {
    render(
      <ServiceGeneralSettings
        service={defaultService}
        teams={mockTeams}
        policies={mockPolicies}
        canManageService={true}
        action={mockAction}
      />
    );

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: 'Auth Core Updated' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
  });

  it('allows clicking an SLA tier card to toggle selection', () => {
    render(
      <ServiceGeneralSettings
        service={defaultService}
        teams={mockTeams}
        policies={mockPolicies}
        canManageService={true}
        action={mockAction}
      />
    );

    // Clicking Gold tier switches to Gold
    const goldButton = screen.getByRole('button', { name: /gold/i });
    fireEvent.click(goldButton);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('disables controls when canManageService is false', () => {
    render(
      <ServiceGeneralSettings
        service={defaultService}
        teams={mockTeams}
        policies={mockPolicies}
        canManageService={false}
        action={mockAction}
      />
    );

    expect(screen.getByLabelText(/service name/i)).toBeDisabled();
    expect(screen.getByLabelText(/description/i)).toBeDisabled();
    expect(screen.getByLabelText(/owning team/i)).toBeDisabled();
    expect(screen.getByLabelText(/default escalation policy/i)).toBeDisabled();
    expect(screen.getByLabelText(/primary region/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });
});
