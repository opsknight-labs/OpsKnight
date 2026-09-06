import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  IncidentAlertProvider,
  useIncidentAlert,
  AUTO_DISMISS_TIMEOUT_MS,
  DISMISSED_STORAGE_KEY,
  SHOWN_STORAGE_KEY,
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
      result.current.dismissBanner();
    });

    expect(result.current.isBannerVisible).toBe(false);
    expect(result.current.isDismissed).toBe(true);
    expect(sessionStorage.getItem('opsknight:banner_dismissed_at')).toBeDefined();
    expect(Number(sessionStorage.getItem('opsknight:banner_dismissed_at'))).toBeGreaterThan(0);
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

  it('once dismissed via X, banner remains hidden across route changes unless a new P1 incident arrives', () => {
    const existingIncident = {
      id: 'inc-existing',
      title: 'Current Outage',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    };

    mockUseRealtime.mockReturnValue({
      recentIncidents: [existingIncident],
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider>{children}</IncidentAlertProvider>
    );

    const { result, rerender } = renderHook(() => useIncidentAlert(), { wrapper });

    expect(result.current.isBannerVisible).toBe(true);

    // User dismisses banner on current page
    act(() => {
      result.current.dismissBanner();
    });

    expect(result.current.isBannerVisible).toBe(false);

    // User navigates to /services (simulate route change)
    mockPathname.mockReturnValue('/services');
    rerender();

    // Banner MUST remain hidden across pages
    expect(result.current.isBannerVisible).toBe(false);

    // Now a brand-new P1 incident occurs in real-time
    const newArrival = {
      id: 'inc-new-p1',
      title: 'New Catastrophic P1 Outage',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
    };

    act(() => {
      mockUseRealtime.mockReturnValue({
        recentIncidents: [existingIncident, newArrival],
      });
      rerender();
    });

    // The brand-new P1 incident MUST re-open the banner across all pages!
    expect(result.current.isBannerVisible).toBe(true);
    expect(result.current.currentIncident?.id).toBe('inc-new-p1');
  });

  it('excludes stale incidents older than 24 hours from the emergency banner', () => {
    const staleIncident = {
      id: 'inc-old',
      title: 'Old Incident from last week',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), // 7 days ago
    };

    mockUseRealtime.mockReturnValue({
      recentIncidents: [staleIncident],
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    // Should be excluded from emergency banner
    expect(result.current.activeCriticalIncidents).toHaveLength(0);
    expect(result.current.isBannerVisible).toBe(false);
  });

  it('auto-dismisses the banner after 120 seconds and remains hidden across route changes until next incident', () => {
    vi.useFakeTimers();
    try {
      const existingIncident = {
        id: 'inc-auto-dismiss',
        title: 'High Urgency Outage',
        status: 'OPEN',
        priority: null,
        urgency: 'HIGH',
        createdAt: new Date().toISOString(),
      };

      mockUseRealtime.mockReturnValue({
        recentIncidents: [existingIncident],
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <IncidentAlertProvider>{children}</IncidentAlertProvider>
      );

      const { result, rerender } = renderHook(() => useIncidentAlert(), { wrapper });

      expect(result.current.isBannerVisible).toBe(true);
      expect(sessionStorage.getItem(SHOWN_STORAGE_KEY)).toBeDefined();

      // Advance clock by 119 seconds -> banner should still be visible
      act(() => {
        vi.advanceTimersByTime(119 * 1000);
      });
      expect(result.current.isBannerVisible).toBe(true);

      // Advance clock by remaining 1 second (total 120s) -> auto-dismiss triggers!
      act(() => {
        vi.advanceTimersByTime(1 * 1000);
      });

      expect(result.current.isBannerVisible).toBe(false);
      expect(result.current.isDismissed).toBe(true);
      expect(sessionStorage.getItem(DISMISSED_STORAGE_KEY)).toBeDefined();
      expect(sessionStorage.getItem(SHOWN_STORAGE_KEY)).toBeNull();

      // Navigating to another route should maintain dismissal
      mockPathname.mockReturnValue('/incidents');
      rerender();
      expect(result.current.isBannerVisible).toBe(false);

      // A new HIGH incident arrives -> restores banner visibility and resets cycle
      const newHighIncident = {
        id: 'inc-new-high',
        title: 'New High Urgency Service Disruption',
        status: 'OPEN',
        priority: null,
        urgency: 'HIGH',
        createdAt: new Date().toISOString(),
      };

      act(() => {
        mockUseRealtime.mockReturnValue({
          recentIncidents: [existingIncident, newHighIncident],
        });
        rerender();
      });

      expect(result.current.isBannerVisible).toBe(true);
      expect(result.current.currentIncident?.id).toBe('inc-new-high');
    } finally {
      vi.useRealTimers();
    }
  });

  it('initializes as dismissed if 120 seconds have already elapsed in sessionStorage without showing banner', () => {
    const shownTimestamp = Date.now() - 130 * 1000; // 130s ago (>120s)
    sessionStorage.setItem(SHOWN_STORAGE_KEY, String(shownTimestamp));

    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-past-timer',
        title: 'Past 120s Incident',
        status: 'OPEN',
        urgency: 'HIGH',
        priority: null,
        createdAt: new Date(shownTimestamp).toISOString(),
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    // Should immediately be dismissed without flashing
    expect(result.current.isBannerVisible).toBe(false);
    expect(result.current.isDismissed).toBe(true);
    expect(sessionStorage.getItem(DISMISSED_STORAGE_KEY)).toBe(String(shownTimestamp + AUTO_DISMISS_TIMEOUT_MS));
    expect(sessionStorage.getItem(SHOWN_STORAGE_KEY)).toBeNull();
  });

  it('supports HIGH urgency incidents when P1 is not declared, sorting them at rank 1 ahead of P2', () => {
    const initialIncidents: CriticalIncidentSummary[] = [
      {
        id: 'inc-p2',
        title: 'Cache Latency Warning',
        status: 'OPEN',
        priority: 'P2',
        urgency: 'MEDIUM',
        createdAt: '2026-09-06T10:00:00Z',
      },
      {
        id: 'inc-high-no-p1',
        title: 'Payment API Gateway Failure',
        status: 'OPEN',
        priority: null, // P1 not declared!
        urgency: 'HIGH',
        createdAt: '2026-09-06T09:00:00Z',
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider initialIncidents={initialIncidents}>{children}</IncidentAlertProvider>
    );

    const { result } = renderHook(() => useIncidentAlert(), { wrapper });

    expect(result.current.totalCount).toBe(2);
    // Even though created earlier than inc-p2 and priority is null, urgency HIGH puts it at rank 1
    expect(result.current.currentIncident?.id).toBe('inc-high-no-p1');
    expect(result.current.activeCriticalIncidents[0].id).toBe('inc-high-no-p1');
    expect(result.current.activeCriticalIncidents[1].id).toBe('inc-p2');
  });

  it('re-triggers banner and clears dismissal when an incident escalates to HIGH urgency without declared P1', () => {
    const existingIncident = {
      id: 'inc-escalate',
      title: 'Slow Database Query',
      status: 'OPEN',
      priority: null,
      urgency: 'MEDIUM',
      createdAt: new Date(Date.now() - 100000).toISOString(),
    };

    mockUseRealtime.mockReturnValue({
      recentIncidents: [existingIncident],
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider>{children}</IncidentAlertProvider>
    );

    const { result, rerender } = renderHook(() => useIncidentAlert(), { wrapper });

    // User dismisses banner
    act(() => {
      result.current.dismissBanner();
    });
    expect(result.current.isBannerVisible).toBe(false);

    // Incident escalates to urgency: HIGH in real-time (priority remains undeclared)
    const escalatedIncident = {
      ...existingIncident,
      title: 'Database Outage - Critical Slowdown',
      urgency: 'HIGH',
      updatedAt: new Date().toISOString(),
    };

    act(() => {
      mockUseRealtime.mockReturnValue({
        recentIncidents: [escalatedIncident],
      });
      rerender();
    });

    // Escalation to HIGH urgency MUST re-trigger the banner!
    expect(result.current.isBannerVisible).toBe(true);
    expect(result.current.currentIncident?.id).toBe('inc-escalate');
    expect(result.current.currentIncident?.urgency).toBe('HIGH');
  });

  it('does NOT break prior dismissal when a new non-critical (P2/MEDIUM) incident arrives', () => {
    const p1Incident = {
      id: 'inc-initial-p1',
      title: 'Initial Outage',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(Date.now() - 60000).toISOString(),
    };

    mockUseRealtime.mockReturnValue({
      recentIncidents: [p1Incident],
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IncidentAlertProvider>{children}</IncidentAlertProvider>
    );

    const { result, rerender } = renderHook(() => useIncidentAlert(), { wrapper });
    expect(result.current.isBannerVisible).toBe(true);

    // Dismiss banner
    act(() => {
      result.current.dismissBanner();
    });
    expect(result.current.isBannerVisible).toBe(false);

    // A P2 incident with MEDIUM urgency arrives
    const p2Arrival = {
      id: 'inc-p2-medium',
      title: 'Secondary Service Warning',
      status: 'OPEN',
      priority: 'P2',
      urgency: 'MEDIUM',
      createdAt: new Date().toISOString(),
    };

    act(() => {
      mockUseRealtime.mockReturnValue({
        recentIncidents: [p1Incident, p2Arrival],
      });
      rerender();
    });

    // P2/MEDIUM incident should NOT break the dismissal
    expect(result.current.isBannerVisible).toBe(false);
  });
});
