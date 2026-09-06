import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentListItem } from '@/types/incident-list';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  realtime: { recentIncidents: [] as Record<string, unknown>[], isConnected: true },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => mocks.realtime }));
vi.mock('@/app/(app)/incidents/actions', () => ({ updateIncidentStatus: vi.fn() }));
vi.mock('@/app/(app)/incidents/bulk-actions', () => ({}));

import IncidentsListTable from '@/components/incident/IncidentsListTable';

const existing: IncidentListItem = {
  id: 'incident-1',
  title: 'Existing incident',
  status: 'OPEN',
  escalationStatus: null,
  currentEscalationStep: null,
  nextEscalationAt: null,
  priority: 'P2',
  urgency: 'HIGH',
  createdAt: new Date('2026-09-06T10:00:00Z'),
  acknowledgedAt: null,
  resolvedAt: null,
  assigneeId: null,
  teamId: null,
  service: { id: 'service-a', name: 'Service A' },
  team: null,
  assignee: null,
};

describe('IncidentsListTable realtime projection', () => {
  beforeEach(() => {
    mocks.refresh.mockClear();
    mocks.realtime.recentIncidents = [];
  });

  it('patches matching rows locally without refreshing the route', () => {
    const { rerender } = render(
      <IncidentsListTable
        incidents={[existing]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a' }}
      />
    );
    mocks.realtime.recentIncidents = [
      {
        ...existing,
        id: 'incident-2',
        title: 'Realtime incident',
        service: { id: 'service-a', name: 'Service A' },
      },
    ];
    rerender(
      <IncidentsListTable
        incidents={[existing]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a' }}
      />
    );
    expect(screen.getByText('Realtime incident')).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('does not inject an incident outside the active filter', () => {
    const { rerender } = render(
      <IncidentsListTable
        incidents={[existing]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a' }}
      />
    );
    mocks.realtime.recentIncidents = [
      {
        ...existing,
        id: 'incident-2',
        title: 'Other service',
        service: { id: 'service-b', name: 'Service B' },
      },
    ];
    rerender(
      <IncidentsListTable
        incidents={[existing]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a' }}
      />
    );
    expect(screen.queryByText('Other service')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
