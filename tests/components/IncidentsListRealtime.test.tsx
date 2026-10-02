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
  slaPausedMs: 0,
  slaAckTargetMs: 900000,
  slaResolveTargetMs: 7200000,
  slaTargetSource: 'SERVICE_DEFAULT',
  slaTargetCapturedAt: new Date('2026-09-06T10:00:00Z'),
  slaPauseStartedAt: null,
  slaAckElapsedMs: null,
  slaResolveElapsedMs: null,
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

  it('removes resolved incidents from critical focus during realtime updates', () => {
    const criticalIncident: IncidentListItem = {
      ...existing,
      urgency: 'HIGH',
      priority: 'P1',
    };
    const { rerender } = render(
      <IncidentsListTable
        incidents={[criticalIncident]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ filter: 'critical_focus' }}
      />
    );
    mocks.realtime.recentIncidents = [{ ...criticalIncident, status: 'RESOLVED' }];
    rerender(
      <IncidentsListTable
        incidents={[criticalIncident]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ filter: 'critical_focus' }}
      />
    );
    expect(screen.queryByText(criticalIncident.title)).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('preserves chronological ordering and places newer incidents ahead of older ones', () => {
    const olderSeptember: IncidentListItem = {
      ...existing,
      id: 'incident-sep-1',
      title: 'September 1 Alert',
      createdAt: new Date('2026-09-01T10:00:00Z'),
    };
    const { rerender, container } = render(
      <IncidentsListTable
        incidents={[olderSeptember]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a', sort: 'newest' }}
      />
    );

    // Incoming newer incident from September 7
    mocks.realtime.recentIncidents = [
      {
        ...existing,
        id: 'incident-sep-7',
        title: 'September 7 Alert',
        createdAt: new Date('2026-09-07T12:00:00Z'),
        service: { id: 'service-a', name: 'Service A' },
      },
    ];

    rerender(
      <IncidentsListTable
        incidents={[olderSeptember]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a', sort: 'newest' }}
      />
    );

    expect(screen.getByText('September 7 Alert')).toBeInTheDocument();
    expect(screen.getByText('September 1 Alert')).toBeInTheDocument();

    // Verify September 7 comes BEFORE September 1 in the DOM
    const textContent = container.textContent || '';
    const idxSep7 = textContent.indexOf('September 7 Alert');
    const idxSep1 = textContent.indexOf('September 1 Alert');
    expect(idxSep7).toBeLessThan(idxSep1);
  });

  it('does not prepend historical February/August incidents ahead of newer September incidents', () => {
    const septemberAlert: IncidentListItem = {
      ...existing,
      id: 'incident-sep',
      title: 'September Incident',
      createdAt: new Date('2026-09-05T10:00:00Z'),
    };
    const { rerender, container } = render(
      <IncidentsListTable
        incidents={[septemberAlert]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a', sort: 'newest' }}
      />
    );

    // Incoming historical February incident that had its updatedAt bumped
    mocks.realtime.recentIncidents = [
      {
        ...existing,
        id: 'incident-feb',
        title: 'February Incident',
        createdAt: new Date('2026-02-10T08:00:00Z'),
        updatedAt: new Date('2026-09-07T12:00:00Z'),
        service: { id: 'service-a', name: 'Service A' },
      },
    ];

    rerender(
      <IncidentsListTable
        incidents={[septemberAlert]}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a', sort: 'newest' }}
      />
    );

    // Both may be displayed if within maxItems, but September MUST be before February
    const textContent = container.textContent || '';
    const idxSep = textContent.indexOf('September Incident');
    const idxFeb = textContent.indexOf('February Incident');
    expect(idxSep).toBeLessThan(idxFeb);
  });

  it('bounds the list to max items and discards older historical incidents when list is full', () => {
    // Fill a list to its capacity (15 items for dashboard)
    const items: IncidentListItem[] = Array.from({ length: 15 }, (_, i) => ({
      ...existing,
      id: `incident-sep-${i}`,
      title: `September Incident #${i + 1}`,
      createdAt: new Date(`2026-09-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    }));

    const { rerender } = render(
      <IncidentsListTable
        incidents={items}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a', sort: 'newest' }}
      />
    );

    // Incoming February incident with recent updatedAt
    mocks.realtime.recentIncidents = [
      {
        ...existing,
        id: 'incident-feb-stale',
        title: 'Stale February Incident',
        createdAt: new Date('2026-02-01T10:00:00Z'),
        updatedAt: new Date('2026-09-07T13:00:00Z'),
        service: { id: 'service-a', name: 'Service A' },
      },
    ];

    rerender(
      <IncidentsListTable
        incidents={items}
        users={[]}
        canManageIncidents={false}
        readOnly
        realtimeFilter={{ serviceId: 'service-a', sort: 'newest' }}
      />
    );

    // Stale February incident is trimmed off because the list is bounded to 15 items
    expect(screen.queryByText('Stale February Incident')).toBeNull();
  });
});
