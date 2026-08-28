import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import type { IncidentListItem } from '@/types/incident-list';

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
});
