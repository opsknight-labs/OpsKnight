import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LiveSnapshot } from '@/lib/dashboard/live-incidents-shared';

const live = vi.hoisted(() => ({
  value: {} as { snapshot: Partial<LiveSnapshot> | null; loading: boolean },
}));

vi.mock('@/components/dashboard/live/LiveDashboardProvider', () => ({
  useLiveDashboard: () => ({
    ...live.value,
    now: Date.now(),
    setQuery: vi.fn(),
    currentUserId: 'u1',
    query: {},
  }),
}));

import { OnCallCard, SlaRiskCard } from '@/components/dashboard/live/ResponderRail';

const snapshot = (overrides: Partial<LiveSnapshot>): Partial<LiveSnapshot> => ({
  summary: {
    slaAtRisk: 0,
    slaDueSoon: 0,
    slaRecentlyBreached: 0,
  } as LiveSnapshot['summary'],
  rail: { myQueue: [], slaRisk: [], servicesAtRisk: [], activity: [], onCall: [] },
  ...overrides,
});

describe('rail cards when live data is missing', () => {
  beforeEach(() => {
    live.value = { snapshot: null, loading: false };
  });

  it('does not claim everything is within SLA before any snapshot exists', () => {
    render(<SlaRiskCard />);
    expect(screen.queryByText('Everything is within SLA')).not.toBeInTheDocument();
    expect(screen.getByText('SLA state unavailable')).toBeInTheDocument();
  });

  it('says loading while the first snapshot is on its way', () => {
    live.value = { snapshot: null, loading: true };
    render(<SlaRiskCard />);
    expect(screen.getByText('Loading SLA state…')).toBeInTheDocument();
  });

  it('keeps the all-clear message when the snapshot really has nothing at risk', () => {
    live.value = { snapshot: snapshot({ unavailable: [] }), loading: false };
    render(<SlaRiskCard />);
    expect(screen.getByText('Everything is within SLA')).toBeInTheDocument();
  });

  it('shows on-call as unavailable, not as no shifts, when that read failed', () => {
    live.value = { snapshot: snapshot({ unavailable: ['onCall'] }), loading: false };
    render(<OnCallCard />);
    expect(screen.queryByText('No active on-call shifts')).not.toBeInTheDocument();
    expect(screen.getByText('On-call shifts unavailable')).toBeInTheDocument();
  });

  it('still says no shifts when the read succeeded and nobody is on call', () => {
    live.value = { snapshot: snapshot({ unavailable: [] }), loading: false };
    render(<OnCallCard />);
    expect(screen.getByText('No active on-call shifts')).toBeInTheDocument();
  });
});
