import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IncidentSlaClientView from '@/components/settings/incident-sla/IncidentSlaClientView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    userTimeZone: 'UTC',
  }),
}));

vi.mock('@/components/incident-sla/IncidentSlaPolicySettings', () => ({
  default: () => <div data-testid="mock-sla-policy-settings">SLA Policy Settings Mock</div>,
}));

vi.mock('@/components/incident-sla/IncidentClassificationSettings', () => ({
  default: () => <div data-testid="mock-classification-settings">Classification Settings Mock</div>,
}));

vi.mock('@/components/incident-sla/ResponsePolicyOperations', () => ({
  default: () => <div data-testid="mock-operations-settings">Response Operations Mock</div>,
}));

describe('IncidentSlaClientView', () => {
  const defaultProps = {
    policy: {
      version: 3,
      inheritWorkspace: false,
      baseAckTargetMs: 15 * 60 * 1000, // 15m
      baseResolveTargetMs: 4 * 3600 * 1000, // 4h
      rules: [
        {
          priority: 'P1',
          ackTargetMs: 5 * 60000,
          resolveTargetMs: 60 * 60000,
          label: 'P1 Critical',
        },
        { priority: 'P2', ackTargetMs: 15 * 60000, resolveTargetMs: 120 * 60000, label: 'P2 High' },
      ],
    },
    classificationPolicy: {
      version: 2,
      derivePriorityFromUrgency: true,
      priorityFallbackMode: 'INHERIT' as const,
      rules: [],
    },
    serviceCount: 12,
    inheritingCount: 9,
    services: [
      { id: 'srv-1', name: 'Order Service' },
      { id: 'srv-2', name: 'Billing API' },
    ],
    integrations: [{ id: 'int-1', name: 'Datadog', serviceId: 'srv-1' }],
    supportHoursPolicy: {
      version: 1,
      timezone: 'UTC',
      mode: 'ALWAYS' as const,
      windows: [],
      exceptions: [],
    },
    scheduler: {
      mode: 'INDEXED' as const,
      indexReady: true,
      missingHints: 0,
      due: 0,
      shadowCleanChecks: 15,
      shadowMismatches: 0,
    },
  };

  it('renders canonical DetailHeroBanner with title, badges, and stats capsules', () => {
    render(<IncidentSlaClientView {...defaultProps} />);

    // Breadcrumbs & Title
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Incident SLAs & Response Policies' })
    ).toBeInTheDocument();

    // Badges
    expect(screen.getByText('Active · SLA v3')).toBeInTheDocument();
    expect(screen.getByText('Workspace Scope')).toBeInTheDocument();

    // Stats capsules
    expect(screen.getByText('Fallback SLA')).toBeInTheDocument();
    expect(screen.getByText('15m ack / 4h res')).toBeInTheDocument();

    expect(screen.getByText('Priority Rules')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument();

    expect(screen.getByText('Services Inheriting')).toBeInTheDocument();
    expect(screen.getByText('9 / 12')).toBeInTheDocument();

    expect(screen.getByText('SLA Scheduler')).toBeInTheDocument();
    expect(screen.getByText('INDEXED · Ready')).toBeInTheDocument();

    // Action links
    expect(screen.getByRole('link', { name: /Services/i })).toHaveAttribute('href', '/services');
    expect(screen.getByRole('link', { name: /Settings Hub/i })).toHaveAttribute(
      'href',
      '/settings'
    );
  });

  it('allows navigating between sub-tabs', () => {
    render(<IncidentSlaClientView {...defaultProps} />);

    // Default active tab is objectives
    expect(screen.getByTestId('mock-sla-policy-settings')).toBeInTheDocument();

    // Switch to Alert Classification
    fireEvent.click(screen.getByRole('button', { name: /Alert Classification/i }));
    expect(screen.getByTestId('mock-classification-settings')).toBeInTheDocument();

    // Switch to Support & Schedules
    fireEvent.click(screen.getByRole('button', { name: /Support & Schedules/i }));
    expect(screen.getByTestId('mock-operations-settings')).toBeInTheDocument();

    // Switch to Semantics & Reference
    fireEvent.click(screen.getByRole('button', { name: /Semantics & Reference/i }));
    expect(screen.getByText('SLA Evaluation Semantics')).toBeInTheDocument();
    expect(screen.getByText(/Priority · P1–P5/i)).toBeInTheDocument();
    expect(screen.getByText(/Urgency · High/i)).toBeInTheDocument();
    expect(screen.getByText('Alert Severity')).toBeInTheDocument();
  });
});
