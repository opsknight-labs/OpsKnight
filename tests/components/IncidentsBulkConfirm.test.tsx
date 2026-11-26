import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import type { IncidentListItem } from '@/types/incident-list';

const mocks = vi.hoisted(() => ({
  bulkUpdatePriority: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
vi.mock('@/hooks/use-product-notification', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => ({ recentIncidents: [], isConnected: true }),
}));
vi.mock('@/app/(app)/incidents/actions', () => ({
  updateIncidentStatus: vi.fn().mockResolvedValue({ replayed: false }),
}));
vi.mock('@/app/(app)/incidents/bulk-actions', () => ({
  bulkAcknowledge: vi.fn(),
  bulkResolve: vi.fn(),
  bulkReassign: vi.fn(),
  bulkUpdatePriority: mocks.bulkUpdatePriority,
  bulkSnooze: vi.fn(),
  bulkUnsnooze: vi.fn(),
  bulkSuppress: vi.fn(),
  bulkUnsuppress: vi.fn(),
  bulkUpdateUrgency: vi.fn(),
  bulkUpdateStatus: vi.fn(),
}));

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
    service: { id: 'svc-1', name: 'API Gateway' },
    team: null,
    assignee: null,
  },
];

function openPrioritySelect() {
  render(
    <IncidentsListTable
      incidents={incidents}
      users={[{ id: 'user-1', name: 'Alex Doe', email: 'alex@example.com' }]}
      canManageIncidents
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /select incident/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
  return screen.getByLabelText('Select priority for bulk update');
}

describe('bulk select actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for confirmation instead of applying on change', async () => {
    mocks.bulkUpdatePriority.mockResolvedValue({ success: true, count: 1 });
    const select = openPrioritySelect();

    fireEvent.change(select, { target: { value: 'P1' } });

    expect(mocks.bulkUpdatePriority).not.toHaveBeenCalled();
    expect(await screen.findByText('Apply to selected incidents?')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mocks.bulkUpdatePriority).toHaveBeenCalledWith(['inc-1'], 'P1'));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const select = openPrioritySelect();

    fireEvent.change(select, { target: { value: 'P1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Apply to selected incidents?')).toBeNull());
    expect(mocks.bulkUpdatePriority).not.toHaveBeenCalled();
  });

  it('disables the picker controls while the bulk update is running', async () => {
    let finish: (value: { success: boolean; count: number }) => void = () => undefined;
    mocks.bulkUpdatePriority.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const select = openPrioritySelect();

    fireEvent.change(select, { target: { value: 'P1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(mocks.bulkUpdatePriority).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: 'Resolve' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((screen.getByRole('button', { name: 'Reassign' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    finish({ success: true, count: 1 });
  });
});
