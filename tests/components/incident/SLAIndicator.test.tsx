import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SLAIndicator from '@/components/incident/SLAIndicator';
import IncidentSLABadges from '@/components/incident/detail/IncidentSLABadges';
import { projectIncidentSlaState } from '@/lib/incident-sla/state';

const base = {
  status: 'OPEN' as const,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  acknowledgedAt: null,
  resolvedAt: null,
  slaAckTargetMs: 15 * 60_000,
  slaResolveTargetMs: 120 * 60_000,
  slaTargetSource: 'SERVICE_DEFAULT',
  slaTargetCapturedAt: new Date('2025-01-01T00:00:00.000Z'),
  slaPausedMs: 0,
  slaPauseStartedAt: null,
  slaAckElapsedMs: null,
  slaResolveElapsedMs: null,
};

describe('SLAIndicator & IncidentSLABadges', () => {
  it('renders compact SLA chips correctly when breached', () => {
    const state = projectIncidentSlaState(base, { now: new Date('2025-01-01T05:00:00.000Z') });
    render(<IncidentSLABadges sla={state} />);
    expect(screen.getByText('Response Health')).toBeDefined();
    expect(screen.getByText('Ack')).toBeDefined();
    expect(screen.getByText('Resolve')).toBeDefined();
    expect(screen.getAllByText('Breached').length).toBeGreaterThanOrEqual(1);
  });

  it('renders detailed card grid view when showDetails is true', () => {
    const state = projectIncidentSlaState(base, { now: new Date('2025-01-01T00:05:00.000Z') });
    render(<SLAIndicator sla={state} showDetails />);
    expect(screen.getByText('Acknowledgement SLA')).toBeDefined();
    expect(screen.getByText('Resolution SLA')).toBeDefined();
    expect(screen.getAllByRole('progressbar').length).toBe(2);
  });

  it('renders graceful fallback when sla is null', () => {
    render(<IncidentSLABadges sla={null} />);
    expect(screen.getByText('Evaluating SLA…')).toBeDefined();
  });
});
