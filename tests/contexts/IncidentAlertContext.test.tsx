import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  IncidentAlertProvider,
  useIncidentAlert,
  type CriticalIncidentSummary,
} from '@/contexts/IncidentAlertContext';

const mockUseRealtime = vi.fn();
vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => mockUseRealtime(),
}));

const mockPathname = vi.fn().mockReturnValue('/');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const mockUpdateIncidentStatus = vi.fn();
vi.mock('@/app/(app)/incidents/actions', () => ({
  updateIncidentStatus: (id: string, status: string) => mockUpdateIncidentStatus(id, status),
}));

const mockNotify = {
  success: vi.fn(),
  error: vi.fn(),
  incident: vi.fn(),
};
vi.mock('@/lib/toast', () => ({
  notify: {
    success: (...args: unknown[]) => mockNotify.success(...args),
    error: (...args: unknown[]) => mockNotify.error(...args),
    incident: (...args: unknown[]) => mockNotify.incident(...args),
  },
}));

describe('IncidentAlertContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/');
    mockUseRealtime.mockReturnValue({ recentIncidents: [] });
    sessionStorage.clear();
  });

  it('initializes activeCriticalIncidents from initialIncidents filtering out resolved and low-priority ones', () => {
    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-p1',
        title: 'Database failure',
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: '2026-09-06T10:00:00Z',
      },
      {
        id: 'inc-p2',
        title: 'Cache high latency',
        status: 'OPEN',
        priority: 'P2',
        urgency: 'MEDIUM',
        createdAt: '2026-09-06T09:00:00Z',
      },
      {
        id: 'inc-p3',
        title: 'Minor UI typo',
        status: 'OPEN',
        priority: 'P3',
        urgency: 'LOW',
        createdAt: '2026-09-06T08:00:00Z',
      },
      {
        id: 'inc-resolved',
        title: 'Old outage',
        status: 'RESOLVED',
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: '2026-09-06T07:00:00Z',
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    expect(result.current.totalCount).toBe(2);
    expect(result.current.activeCriticalIncidents).toHaveLength(2);
    expect(result.current.currentIncident?.id).toBe('inc-p1');
    expect(result.current.isBannerVisible).toBe(true);
  });

  it('navigates next and previous across multiple critical incidents', () => {
    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-1',
        title: 'P1 Outage',
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: '2026-09-06T10:00:00Z',
      },
      {
        id: 'inc-2',
        title: 'P2 Outage',
        status: 'OPEN',
        priority: 'P2',
        urgency: 'MEDIUM',
        createdAt: '2026-09-06T09:30:00Z',
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentIncident?.id).toBe('inc-1');

    act(() => {
      result.current.nextIncident();
    });
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.currentIncident?.id).toBe('inc-2');

    act(() => {
      result.current.prevIncident();
    });
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentIncident?.id).toBe('inc-1');
  });

  it('snoozes the current incident and persists in sessionStorage', () => {
    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-1',
        title: 'P1 Outage',
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: '2026-09-06T10:00:00Z',
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    expect(result.current.isBannerVisible).toBe(true);

    act(() => {
      result.current.snoozeBanner();
    });

    expect(result.current.isBannerVisible).toBe(false);
    expect(result.current.isSnoozed).toBe(true);
    expect(sessionStorage.getItem('opsknight:snoozed_critical_incidents')).toContain('inc-1');
  });

  it('contextually suppresses banner when viewing the incident on /incidents/[id]', () => {
    mockPathname.mockReturnValue('/incidents/inc-1');

    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-1',
        title: 'P1 Outage',
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: '2026-09-06T10:00:00Z',
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    // inc-1 is suppressed because the user is already looking at it
    expect(result.current.isBannerVisible).toBe(false);
    expect(result.current.currentIncident).toBeNull();
  });

  it('acknowledges an incident and optimistically updates status', async () => {
    mockUpdateIncidentStatus.mockResolvedValue({ success: true });

    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-1',
        title: 'P1 Outage',
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        createdAt: '2026-09-06T10:00:00Z',
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    await act(async () => {
      await result.current.acknowledgeIncident('inc-1');
    });

    expect(mockUpdateIncidentStatus).toHaveBeenCalledWith('inc-1', 'ACKNOWLEDGED');
    expect(mockNotify.success).toHaveBeenCalledWith('Incident acknowledged');
    expect(result.current.currentIncident?.status).toBe('ACKNOWLEDGED');
  });

  it('does NOT trigger real-time toast on initial mount for existing stale incidents', () => {
    // Recent incidents from SSE contains an incident created 2 hours ago
    mockUseRealtime.mockReturnValue({
      recentIncidents: [
        {
          id: 'inc-stale',
          title: 'Stale Incident',
          status: 'OPEN',
          priority: 'P1',
          urgency: 'HIGH',
          createdAt: new Date(Date.now() - 7200000).toISOString(),
        },
      ],
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={[]}>{children}</IncidentAlertProvider>
    );

    renderHook(() => useIncidentAlert(), { wrapper });

    // notify.incident MUST NOT be called for stale incidents on mount
    expect(mockNotify.incident).not.toHaveBeenCalled();
  });

  it('triggers real-time toast for truly newly created incidents arrived via SSE', () => {
    // Recent incident created right now (after mount timestamp)
    const freshIncident = {
      id: 'inc-fresh',
      title: 'Fresh Critical Incident',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
      service: { id: 'svc-1', name: 'API' },
    };

    mockUseRealtime.mockReturnValue({
      recentIncidents: [freshIncident],
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={[]}>{children}</IncidentAlertProvider>
    );

    renderHook(() => useIncidentAlert(), { wrapper });

    expect(mockNotify.incident).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'inc-fresh',
        title: 'Fresh Critical Incident',
        priority: 'P1',
      }),
      expect.anything()
    );
  });
});
