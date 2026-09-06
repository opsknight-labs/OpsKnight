import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IncidentQuickLinksCard from '@/components/incident/detail/IncidentQuickLinksCard';

describe('IncidentQuickLinksCard', () => {
  const defaultProps = {
    incidentId: 'inc-123',
    service: {
      id: 'srv-1',
      name: 'Authentication API',
      status: 'OPERATIONAL',
      slaTier: 'Tier 1',
      policy: {
        id: 'pol-1',
        name: 'Critical Escalation',
      },
    },
    team: {
      id: 'team-1',
      name: 'Core Infra',
    },
    warRoomUrl: 'https://meet.jit.si/opsknight-warroom-123',
  };

  it('renders standard service, policy, analytics, team, and war room quick links', () => {
    render(<IncidentQuickLinksCard {...defaultProps} />);

    expect(screen.getByText('Quick Links')).toBeInTheDocument();
    expect(screen.getByText('Authentication API')).toBeInTheDocument();
    expect(screen.getByText('Critical Escalation')).toBeInTheDocument();
    expect(screen.getByText('Incident Analytics')).toBeInTheDocument();
    expect(screen.getByText('Core Infra')).toBeInTheDocument();
    expect(screen.getByText('Join War Room')).toBeInTheDocument();
  });

  it('does not render any duplicate postmortem link in the sidebar quick links', () => {
    render(<IncidentQuickLinksCard {...defaultProps} />);

    expect(screen.queryByText(/postmortem/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/root cause analysis/i)).not.toBeInTheDocument();
  });
});
