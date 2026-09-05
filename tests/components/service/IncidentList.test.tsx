import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import IncidentList from '@/components/service/IncidentList';
import { IncidentStatus } from '@prisma/client';

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

vi.mock('@/hooks/use-product-notification', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('@/app/(app)/incidents/actions', () => ({
  updateIncidentStatus: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/components/incident/CreateIncidentButton', () => ({
  default: ({ serviceId }: { serviceId: string }) => (
    <button data-testid="create-incident-btn">Create Incident for {serviceId}</button>
  ),
}));

describe('IncidentList', () => {
  it('renders empty state when there are no incidents', () => {
    render(<IncidentList incidents={[]} serviceId="service-1" />);

    expect(screen.getByText('No incidents recorded')).toBeInTheDocument();
    expect(
      screen.getByText('This service is running smoothly with no recorded incidents.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('create-incident-btn')).toBeInTheDocument();
  });

  it('renders incident card matching incident page and dashboard layout', () => {
    const mockIncidents = [
      {
        id: 'inc-12345abcdef',
        title: 'Database connection pool exhausted',
        status: IncidentStatus.OPEN,
        urgency: 'HIGH',
        priority: 'P1',
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5m ago
        resolvedAt: null,
        assignee: {
          id: 'user-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          avatarUrl: null,
          gender: null,
        },
        team: null,
      },
      {
        id: 'inc-67890ghijkl',
        title: 'Cache latency degradation',
        status: IncidentStatus.ACKNOWLEDGED,
        urgency: 'MEDIUM',
        priority: 'P2',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
        resolvedAt: null,
        assignee: null,
        team: {
          id: 'team-ops',
          name: 'SRE Team',
        },
      },
      {
        id: 'inc-112233unassigned',
        title: 'Background worker backlog',
        status: IncidentStatus.RESOLVED,
        urgency: 'LOW',
        priority: null,
        createdAt: new Date(Date.now() - 3 * 86400 * 1000),
        resolvedAt: new Date(),
        assignee: null,
        team: null,
      },
    ];

    render(<IncidentList incidents={mockIncidents} serviceId="service-1" />);

    // Titles matching dashboard / incident list card style
    const title1 = screen.getByText('Database connection pool exhausted');
    expect(title1).toBeInTheDocument();
    expect(title1.className).toContain('font-bold');
    expect(title1.className).toContain('text-sm md:text-base');

    // Incident 2 and 3 titles
    expect(screen.getByText('Cache latency degradation')).toBeInTheDocument();
    expect(screen.getByText('Background worker backlog')).toBeInTheDocument();

    // Badges
    expect(screen.getByText(/P1/)).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText(/P2/)).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('LOW')).toBeInTheDocument();

    // Quick triage action buttons (Ack for OPEN, Resolve for ACKNOWLEDGED)
    expect(screen.getByTitle('Acknowledge Incident')).toBeInTheDocument();
    expect(screen.getByTitle('Resolve Incident')).toBeInTheDocument();

    // Assignee / Team / Unassigned matching dashboard
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('SRE Team')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    // Incident ID hashes
    expect(screen.getByText(/BCDEF/)).toBeInTheDocument();
    expect(screen.getByText(/HIJKL/)).toBeInTheDocument();
    expect(screen.getByText(/IGNED/)).toBeInTheDocument();
  });
});
