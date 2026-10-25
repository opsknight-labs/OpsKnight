import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeHybridMetrics } from '@/lib/sla-hybrid-merge';
import { METRIC_ACCUMULATOR, emptyMetricAccumulator } from '@/lib/metrics/domain/accumulator';
import type { SLAMetrics } from '@/lib/sla';

describe('Ops Pulse dashboard contract', () => {
  const pageSource = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const liveSource = readFileSync('src/lib/dashboard/live-incidents.ts', 'utf8');
  const engineSource = readFileSync('src/lib/dashboard/live-incidents-engine.ts', 'utf8');
  const railSource = readFileSync('src/components/dashboard/live/ResponderRail.tsx', 'utf8');

  it('derives critical focus and the user queue from the authorized active set', () => {
    expect(liveSource).toContain('incidentReadWhere(actor)');
    expect(liveSource).toContain('LIVE_ACTIVE_STATUSES');
    expect(engineSource).toContain("case 'critical':\n      return isCriticalIncident(row);");
    expect(engineSource).toContain('row.assignee?.id === ctx.actorId');
  });

  it('renders you, needs-attention, hotspots and coverage in the Ops Pulse panel', () => {
    expect(pageSource).toContain('<OpsPulsePanel />');
    expect(railSource).toContain('data-testid="pulse-you"');
    expect(railSource).toContain('data-testid="pulse-attention"');
    expect(railSource).toContain('data-testid="services-at-risk"');
    expect(railSource).toContain('data-testid="pulse-coverage"');
    // Wallboard still renders the standalone SLA card.
    expect(railSource).toContain('title="SLA at Risk"');
    expect(engineSource).toContain('isCriticalIncident(row) ? 0 : 1');
  });

  it('shows explicit empty states rather than blank widgets', () => {
    expect(railSource).toContain('Your queue is clear');
    expect(railSource).toContain('Everything is within SLA');
    expect(railSource).toContain('Nothing near breach or without an owner');
    expect(railSource).toContain('No service has active incidents');
  });

  it('preserves activeIncidentSummaries in hybrid SLA metrics merging', () => {
    const historicalAcc = emptyMetricAccumulator();
    const liveAcc = emptyMetricAccumulator();

    const historical = {
      totalIncidents: 0,
      highUrgencyCount: 0,
      mediumUrgencyCount: 0,
      lowUrgencyCount: 0,
      [METRIC_ACCUMULATOR]: historicalAcc,
    } as unknown as SLAMetrics;

    const dummySummaries: NonNullable<SLAMetrics['activeIncidentSummaries']> = [
      {
        id: 'inc-1',
        title: 'Critical DB Failure',
        status: 'OPEN',
        urgency: 'HIGH',
        createdAt: new Date(),
        acknowledgedAt: null,
        slaAckDeadline: new Date(),
        slaResolveDeadline: new Date(),
        serviceId: 'srv-1',
        serviceName: 'Database',
        assigneeId: null,
        targetAckMinutes: 15,
        targetResolveMinutes: 120,
        slaState: 'VALID',
      },
    ];

    const live = {
      ...historical,
      activeIncidentSummaries: dummySummaries,
      [METRIC_ACCUMULATOR]: liveAcc,
    } as unknown as SLAMetrics;

    const merged = mergeHybridMetrics(historical, live);
    expect(merged.activeIncidentSummaries).toEqual(dummySummaries);
  });
});
