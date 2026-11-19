import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import type { IncidentListItem } from '@/types/incident-list';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    userTimeZone: 'UTC',
  }),
}));

vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => ({
    recentIncidents: [],
    isConnected: true,
  }),
}));

vi.mock('@/app/(app)/incidents/actions', () => ({
  updateIncidentStatus: vi.fn().mockResolvedValue({ replayed: false }),
}));

vi.mock('@/app/(app)/incidents/bulk-actions', () => ({
  bulkAcknowledge: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkResolve: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkReassign: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkUpdatePriority: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkSnooze: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkUnsnooze: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkSuppress: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkUnsuppress: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkUpdateUrgency: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  bulkUpdateStatus: vi.fn().mockResolvedValue({ success: true, count: 1 }),
}));

describe('IncidentsListTable', () => {
  it('renders bulk action labels without icon glyphs', () => {
    const incidents: IncidentListItem[] = [
      {
        id: 'inc-1',
        title: 'API latency spike',
        status: 'OPEN',
        escalationStatus: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        priority: 'P2',
        urgency: 'HIGH',
        createdAt: new Date('2024-01-01T10:00:00Z'),
        slaPausedMs: 0,
        slaAckTargetMs: 900000,
        slaResolveTargetMs: 3600000,
        slaTargetSource: 'SERVICE_DEFAULT',
        slaTargetCapturedAt: new Date('2024-01-01T10:00:00Z'),
        slaPauseStartedAt: null,
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
        assigneeId: null,
        teamId: null,
        service: {
          id: 'svc-1',
          name: 'API Gateway',
        },
        team: null,
        assignee: null,
      },
    ];

    render(
      <IncidentsListTable
        incidents={incidents}
        users={[{ id: 'user-1', name: 'Alex Doe', email: 'alex@example.com' }]}
        canManageIncidents
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: /select incident/i });
    fireEvent.click(checkbox);

    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'More' })).toBeDefined();
  });

  it('renders quick action buttons visible for OPEN incidents and relative time with tooltip', () => {
    const incidents: IncidentListItem[] = [
      {
        id: 'inc-open-1',
        title: 'Database connection issue',
        status: 'OPEN',
        escalationStatus: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        slaPausedMs: 0,
        slaAckTargetMs: 900000,
        slaResolveTargetMs: 3600000,
        slaTargetSource: 'SERVICE_DEFAULT',
        slaTargetCapturedAt: new Date(),
        slaPauseStartedAt: null,
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
        assigneeId: null,
        teamId: null,
        service: {
          id: 'svc-1',
          name: 'PostgreSQL Primary',
        },
        team: null,
        assignee: null,
      },
    ];

    render(
      <IncidentsListTable
        incidents={incidents}
        users={[{ id: 'user-1', name: 'Alex Doe', email: 'alex@example.com' }]}
        canManageIncidents
      />
    );

    // Ack button is visible for OPEN incident
    const ackBtn = screen.getByTitle('Acknowledge Incident');
    expect(ackBtn).toBeDefined();

    // Relative timestamp is rendered
    expect(screen.getByText(/minutes ago/i)).toBeDefined();

    // Keyboard shortcuts guide is rendered
    expect(screen.getByText('Shortcuts:')).toBeDefined();
  });

  it('supports keyboard navigation via J and selection via X', () => {
    const incidents: IncidentListItem[] = [
      {
        id: 'inc-nav-1',
        title: 'Incident Nav 1',
        status: 'OPEN',
        escalationStatus: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        priority: 'P2',
        urgency: 'LOW',
        createdAt: new Date(),
        slaPausedMs: 0,
        slaAckTargetMs: 900000,
        slaResolveTargetMs: 3600000,
        slaTargetSource: 'SERVICE_DEFAULT',
        slaTargetCapturedAt: new Date(),
        slaPauseStartedAt: null,
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
        assigneeId: null,
        teamId: null,
        service: { id: 'svc-1', name: 'Service 1' },
        team: null,
        assignee: null,
      },
      {
        id: 'inc-nav-2',
        title: 'Incident Nav 2',
        status: 'OPEN',
        escalationStatus: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        priority: 'P3',
        urgency: 'LOW',
        createdAt: new Date(),
        slaPausedMs: 0,
        slaAckTargetMs: 900000,
        slaResolveTargetMs: 3600000,
        slaTargetSource: 'SERVICE_DEFAULT',
        slaTargetCapturedAt: new Date(),
        slaPauseStartedAt: null,
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
        assigneeId: null,
        teamId: null,
        service: { id: 'svc-2', name: 'Service 2' },
        team: null,
        assignee: null,
      },
    ];

    render(<IncidentsListTable incidents={incidents} users={[]} canManageIncidents />);

    // Press 'j' to focus first incident
    fireEvent.keyDown(window, { key: 'j' });
    // Press 'x' to select focused incident
    fireEvent.keyDown(window, { key: 'x' });

    // One incident should now be selected, showing bulk action toolbar
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDefined();

    // Press 'Escape' to deselect
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('renders in readOnly mode without selection checkboxes, shortcuts guide, or triage actions', () => {
    const incidents: IncidentListItem[] = [
      {
        id: 'inc-ro-1',
        title: 'Incident ReadOnly 1',
        status: 'OPEN',
        escalationStatus: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: new Date(),
        slaPausedMs: 0,
        slaAckTargetMs: 900000,
        slaResolveTargetMs: 3600000,
        slaTargetSource: 'SERVICE_DEFAULT',
        slaTargetCapturedAt: new Date(),
        slaPauseStartedAt: null,
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
        assigneeId: null,
        teamId: null,
        service: { id: 'svc-1', name: 'Service 1' },
        team: null,
        assignee: null,
      },
    ];

    render(
      <IncidentsListTable
        incidents={incidents}
        users={[]}
        canManageIncidents={true}
        readOnly={true}
      />
    );

    // No selection checkboxes
    expect(screen.queryByRole('checkbox', { name: /select incident/i })).toBeNull();

    // No shortcuts legend
    expect(screen.queryByText('Shortcuts:')).toBeNull();

    // No select page button
    expect(screen.queryByRole('button', { name: /select all incidents/i })).toBeNull();

    // No quick Ack button
    expect(screen.queryByTitle('Acknowledge Incident')).toBeNull();

    // Key presses have no effect in readOnly mode
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  function makeIncident(id: string, status: IncidentListItem['status'] = 'OPEN'): IncidentListItem {
    return {
      id,
      title: `Incident ${id}`,
      status,
      escalationStatus: null,
      currentEscalationStep: null,
      nextEscalationAt: null,
      priority: 'P2',
      urgency: 'HIGH',
      createdAt: new Date(),
      slaPausedMs: 0,
      slaAckTargetMs: null,
      slaResolveTargetMs: null,
      slaTargetSource: null,
      slaTargetCapturedAt: null,
      slaPauseStartedAt: null,
      slaAckElapsedMs: null,
      slaResolveElapsedMs: null,
      assigneeId: null,
      teamId: null,
      service: { id: 'svc-1', name: 'API Gateway' },
      team: null,
      assignee: null,
    };
  }

  it('clears selections that leave the list when the page changes', () => {
    const { rerender } = render(
      <IncidentsListTable incidents={[makeIncident('page1-a')]} users={[]} canManageIncidents />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /select incident/i }));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDefined();

    rerender(
      <IncidentsListTable incidents={[makeIncident('page2-a')]} users={[]} canManageIncidents />
    );

    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('sends the displayed status as expectedStatus for row status changes', async () => {
    render(
      <IncidentsListTable incidents={[makeIncident('inc-row', 'OPEN')]} users={[]} canManageIncidents />
    );
    fireEvent.click(screen.getByTitle('Acknowledge Incident'));

    await waitFor(() =>
      expect(updateIncidentStatus).toHaveBeenCalledWith('inc-row', 'ACKNOWLEDGED', 'OPEN')
    );
  });
});
