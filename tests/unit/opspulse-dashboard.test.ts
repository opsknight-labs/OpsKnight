import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeHybridMetrics } from '@/lib/sla-hybrid-merge';
import { METRIC_ACCUMULATOR, emptyMetricAccumulator } from '@/lib/metrics/domain/accumulator';
import type { SLAMetrics } from '@/lib/sla';

describe('Ops Pulse dashboard contract', () => {
  const pageSource = readFileSync('src/app/(app)/page.tsx', 'utf8');
  const operationalSource = readFileSync(
    'src/lib/dashboard/dashboard-operational-snapshot.ts',
    'utf8'
  );

  it('queries critical focus incidents directly with authorization and active status', () => {
    expect(pageSource).toContain('criticalFocusIncidents');
    expect(operationalSource).toContain("status: { in: ['OPEN', 'ACKNOWLEDGED'] }");
    expect(operationalSource).toContain("OR: [{ urgency: 'HIGH' }, { priority: 'P1' }]");
    expect(operationalSource).toContain('incidentReadWhere(actor)');
  });

  it('queries user queue incidents and count directly with authorization and active status', () => {
    expect(pageSource).toContain('myQueueIncidents');
    expect(pageSource).toContain('myQueueCount');
    expect(operationalSource).toContain('assigneeId: actor.id');
  });

  it('uses direct query results for criticalFocus and myQueueItems', () => {
    expect(pageSource).toContain('criticalFocusIncidents.slice(0, 3)');
    expect(pageSource).toContain('myQueueIncidents.slice(0, 3)');
    expect(pageSource).toContain('currentCriticalActive');
    expect(pageSource).toContain('Math.max(');
  });

  it('handles empty state properly when critical incidents exist vs all systems stable', () => {
    expect(pageSource).toContain('active critical incident');
    expect(pageSource).toContain('All systems stable');
    expect(pageSource).not.toContain(
      '<ShieldAlert className="w-6 h-6 mx-auto text-rose-400 mb-2" />'
    );
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
