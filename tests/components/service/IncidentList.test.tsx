import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IncidentList from '@/components/service/IncidentList';
import { IncidentStatus } from '@prisma/client';

const mockUpdateIncidentStatus = vi.fn().mockResolvedValue({ success: true });
const mockResolveIncidentWithNote = vi.fn().mockResolvedValue({ replayed: false });

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
  updateIncidentStatus: (...args: unknown[]) => mockUpdateIncidentStatus(...args),
  resolveIncidentWithNote: (...args: unknown[]) => mockResolveIncidentWithNote(...args),
}));

vi.mock('@/components/incident/CreateIncidentButton', () => ({
  default: ({ serviceId }: { serviceId: string }) => (
    <button data-testid="create-incident-btn">Create Incident for {serviceId}</button>
  ),
}));

describe('IncidentList', () => {
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

  it('renders empty state when there are no incidents', () => {
    render(<IncidentList incidents={[]} serviceId="service-1" />);

    expect(screen.getByText('No incidents recorded')).toBeInTheDocument();
    expect(
      screen.getByText('This service is running smoothly with no recorded incidents.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('create-incident-btn')).toBeInTheDocument();
  });

  it('renders incident card with canonical incident page typography and badges', () => {
    render(
      <IncidentList
        incidents={mockIncidents}
        serviceId="service-1"
        serviceName="Order Processing Service"
      />
    );

    // Title typography matches canonical incident page: font-bold text-sm md:text-base
    const title1 = screen.getByText('Database connection pool exhausted');
    expect(title1).toBeInTheDocument();
    expect(title1.className).toContain('text-sm md:text-base');
    expect(title1.className).toContain('font-bold');

    // Incident 2 & 3 titles
    expect(screen.getByText('Cache latency degradation')).toBeInTheDocument();
    expect(screen.getByText('Background worker backlog')).toBeInTheDocument();

    // Badges
    expect(screen.getByText(/P1/)).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/P2/)).toBeInTheDocument();
    expect(screen.getByText('Med')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();

    // Assignee / Team / Unassigned
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('SRE Team')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    // Incident ID hashes
    expect(screen.getByText(/BCDEF/)).toBeInTheDocument();
    expect(screen.getByText(/HIJKL/)).toBeInTheDocument();
    expect(screen.getByText(/IGNED/)).toBeInTheDocument();
  });

  it('allows acknowledging OPEN incident via quick triage action', async () => {
    render(<IncidentList incidents={mockIncidents} serviceId="service-1" />);

    const ackButton = screen.getByTestId('quick-ack-btn');
    expect(ackButton).toBeInTheDocument();

    fireEvent.click(ackButton);

    expect(mockUpdateIncidentStatus).toHaveBeenCalledWith('inc-12345abcdef', 'ACKNOWLEDGED');
  });

  it('opens ResolveIncidentModal on quick Resolve click and requires resolution note', async () => {
    render(
      <IncidentList
        incidents={mockIncidents}
        serviceId="service-1"
        serviceName="Order Processing Service"
      />
    );

    // Quick resolve button appears for ACKNOWLEDGED incident
    const quickResolveButton = screen.getByTestId('quick-resolve-btn');
    expect(quickResolveButton).toBeInTheDocument();

    fireEvent.click(quickResolveButton);

    // Modal opens
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Mark incident/i)).toBeInTheDocument();

    // Fill in valid resolution note (>= 10 chars)
    const textarea = screen.getByPlaceholderText(/Describe the root cause/i);
    fireEvent.change(textarea, {
      target: { value: 'Scaled up the Redis cluster nodes and connection limit.' },
    });

    const submitBtn = screen.getByRole('button', { name: 'Resolve Incident' });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockResolveIncidentWithNote).toHaveBeenCalledWith(
        'inc-67890ghijkl',
        'Scaled up the Redis cluster nodes and connection limit.'
      );
    });
  });

  it('opens ResolveIncidentModal when selecting Resolve from dropdown menu on OPEN incident', async () => {
    render(
      <IncidentList
        incidents={mockIncidents}
        serviceId="service-1"
        serviceName="Order Processing Service"
      />
    );

    // Open dropdown for OPEN incident
    const menuButtons = screen.getAllByRole('button', { name: 'Incident actions' });
    fireEvent.pointerDown(menuButtons[0], { button: 0 });

    // Click Resolve in dropdown
    const resolveMenuItem = await screen.findByRole('menuitem', { name: /resolve/i });
    expect(resolveMenuItem).toBeInTheDocument();

    fireEvent.click(resolveMenuItem);

    // Modal opens for OPEN incident instead of directly resolving without note
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockUpdateIncidentStatus).not.toHaveBeenCalledWith('inc-12345abcdef', 'RESOLVED');
  });
});
