import { describe, expect, it } from 'vitest';
import {
  computeHealth,
  customerReportsReason,
  type HealthBusinessService,
  type HealthInputs,
} from '@/lib/business-services/health';

const NOW = new Date('2026-11-25T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const service = (extra: Partial<HealthBusinessService> = {}): HealthBusinessService => ({
  id: 'bs1',
  criticality: null,
  impactMinUrgency: null,
  impactMaxPriority: null,
  ownerTeamId: null,
  members: [{ serviceId: 's1', critical: true, teamId: null }],
  ...extra,
});

const inputs = (partial: Partial<HealthInputs>): HealthInputs => ({
  now: NOW,
  businessServices: [service({ customerReportThreshold: 10, customerReportWindowMinutes: 30 })],
  supports: [],
  edges: [],
  incidents: [],
  impactRows: [],
  maintenance: new Map(),
  ...partial,
});

const report = (count: number, endedMinutesAgo: number, businessServiceId = 'bs1') => ({
  businessServiceId,
  count,
  windowEnd: minutesAgo(endedMinutesAgo),
});

describe('customerReportsReason', () => {
  it('is off without a threshold', () => {
    expect(customerReportsReason({}, [{ count: 99, windowEnd: NOW }], NOW)).toBeNull();
    expect(
      customerReportsReason({ customerReportThreshold: null }, [{ count: 99, windowEnd: NOW }], NOW)
    ).toBeNull();
  });
  it('sums reports whose window ended inside the lookback', () => {
    const bs = { customerReportThreshold: 10, customerReportWindowMinutes: 30 };
    const reports = [
      { count: 4, windowEnd: minutesAgo(5) },
      { count: 6, windowEnd: minutesAgo(29) },
      { count: 50, windowEnd: minutesAgo(31) },
    ];
    expect(customerReportsReason(bs, reports, NOW)).toEqual({
      kind: 'CUSTOMER_REPORTS',
      status: 'DEGRADED',
      reportCount: 10,
      threshold: 10,
      windowMinutes: 30,
    });
    expect(customerReportsReason(bs, reports.slice(0, 1), NOW)).toBeNull();
  });
  it('defaults the window to 60 minutes and caps it at a day', () => {
    expect(
      customerReportsReason(
        { customerReportThreshold: 1 },
        [{ count: 1, windowEnd: minutesAgo(59) }],
        NOW
      )?.windowMinutes
    ).toBe(60);
    expect(
      customerReportsReason(
        { customerReportThreshold: 1, customerReportWindowMinutes: 99_999 },
        [],
        NOW
      )
    ).toBeNull();
  });
  it('ignores reports dated well in the future', () => {
    expect(
      customerReportsReason(
        { customerReportThreshold: 1 },
        [{ count: 5, windowEnd: new Date(NOW.getTime() + 3_600_000) }],
        NOW
      )
    ).toBeNull();
  });
});

describe('computeHealth with customer reports', () => {
  it('lifts an otherwise operational service to DEGRADED, never higher', () => {
    const health = computeHealth(inputs({ customerReports: [report(500, 1)] })).get('bs1')!;
    expect(health.status).toBe('DEGRADED');
    expect(health.reasons).toHaveLength(1);
    expect(health.reasons[0]).toMatchObject({ kind: 'CUSTOMER_REPORTS', reportCount: 500 });
    expect(health.openIncidentCount).toBe(0);
  });

  it('stays operational below the threshold or when reports are old or belong to another service', () => {
    for (const customerReports of [
      [report(9, 1)],
      [report(100, 45)],
      [report(100, 1, 'other')],
      [],
    ])
      expect(computeHealth(inputs({ customerReports })).get('bs1')!.status).toBe('OPERATIONAL');
  });

  it('is inert when the threshold is not configured', () => {
    const health = computeHealth(
      inputs({ businessServices: [service()], customerReports: [report(500, 1)] })
    ).get('bs1')!;
    expect(health.status).toBe('OPERATIONAL');
  });

  it('never lowers an outage: with a major incident it only adds a reason', () => {
    const health = computeHealth(
      inputs({
        incidents: [
          {
            id: 'i1',
            serviceId: 's1',
            urgency: 'HIGH',
            priority: null,
            createdAt: minutesAgo(20),
          },
        ],
        customerReports: [report(500, 1)],
      })
    ).get('bs1')!;
    expect(health.status).toBe('MAJOR_OUTAGE');
    expect(health.reasons.map(reason => reason.kind)).toEqual(['DIRECT', 'CUSTOMER_REPORTS']);
    expect(health.openIncidentCount).toBe(1);
  });

  it('does not override planned maintenance', () => {
    const health = computeHealth(
      inputs({ maintenance: new Map([['s1', 'mw1']]), customerReports: [report(500, 1)] })
    ).get('bs1')!;
    expect(health.status).toBe('MAINTENANCE');
    expect(health.reasons.some(reason => reason.kind === 'CUSTOMER_REPORTS')).toBe(false);
  });

  it('does not propagate to a parent business service through nesting', () => {
    const health = computeHealth(
      inputs({
        businessServices: [
          service({ id: 'child', customerReportThreshold: 1 }),
          service({ id: 'parent', members: [] }),
        ],
        supports: [{ parentId: 'parent', childId: 'child' }],
        customerReports: [report(5, 1, 'child')],
      })
    );
    expect(health.get('child')!.status).toBe('DEGRADED');
    expect(health.get('parent')!.status).not.toBe('DEGRADED');
  });
});
