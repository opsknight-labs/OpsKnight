import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bs: vi.fn(), stats: vi.fn(), timeline: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: { businessService: { findFirst: mocks.bs } } }));
vi.mock('@/lib/business-services/stats', () => ({
  getBusinessServiceStats: mocks.stats,
  getImpactTimeline: mocks.timeline,
}));

import {
  getBusinessServiceSlaReport,
  monthWindow,
  slaReportCsv,
  slaReportPdf,
} from '@/lib/business-services/sla-report';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const NOW = new Date('2026-11-26T12:00:00Z');
const admin: AuthorizationActor = { id: 'u', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
const viewer: AuthorizationActor = { id: 'v', role: 'USER', status: 'ACTIVE', teamIds: ['t'] };

describe('monthWindow', () => {
  it('spans one UTC month and flags the running month', () => {
    expect(monthWindow('2026-10', NOW)).toEqual({
      month: '2026-10',
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-11-01T00:00:00Z'),
      monthToDate: false,
    });
    expect(monthWindow(undefined, NOW)).toMatchObject({ month: '2026-11', monthToDate: true });
  });
  it('rejects future months and months beyond the retention window', () => {
    expect(() => monthWindow('2026-12', NOW)).toThrow();
    expect(() => monthWindow('2025-09', NOW)).toThrow();
  });
});

describe('getBusinessServiceSlaReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bs.mockResolvedValue({
      id: 'bs1',
      name: 'Checkout',
      sloTarget: 99.9,
      revenuePerHourCents: 600_000,
      currency: 'EUR',
    });
    mocks.stats.mockResolvedValue({
      uptimePercent: 99.8,
      weightedUptimePercent: 99.85,
      impactMinutes: 90,
      weightedDowntimeMinutes: 60,
      incidentCount: 2,
      mttaMinutes: 4,
      mttrMinutes: 45,
    });
    mocks.timeline.mockResolvedValue([
      {
        incidentId: 'i1',
        incidentTitle: 'Payments down',
        urgency: 'HIGH',
        source: 'DIRECT',
        excluded: false,
        startedAt: new Date('2026-09-30T23:30:00Z'),
        endedAt: new Date('2026-10-01T00:30:00Z'),
      },
      // Hidden incident and excluded impact are not listed.
      {
        incidentId: null,
        incidentTitle: null,
        urgency: null,
        source: 'DIRECT',
        excluded: false,
        startedAt: new Date('2026-10-05T00:00:00Z'),
        endedAt: null,
      },
      {
        incidentId: 'i3',
        incidentTitle: 'x',
        urgency: 'LOW',
        source: 'MANUAL',
        excluded: true,
        startedAt: new Date('2026-10-06T00:00:00Z'),
        endedAt: null,
      },
    ]);
  });

  it('reports uptime, SLO missed, downtime and incidents clipped to the month', async () => {
    const report = await getBusinessServiceSlaReport('bs1', '2026-10', admin, NOW);
    expect(report).toMatchObject({
      name: 'Checkout',
      month: '2026-10',
      sloTarget: 99.9,
      sloMet: false,
      downtimeMinutes: 90,
      incidentCount: 2,
      estimatedCostCents: 600_000,
      currency: 'EUR',
    });
    expect(report.incidents).toEqual([expect.objectContaining({ id: 'i1', impactMinutes: 30 })]);
    expect(mocks.stats).toHaveBeenCalledWith(
      'bs1',
      { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') },
      admin
    );
  });

  it('leaves out financial fields for readers without financial access', async () => {
    const report = await getBusinessServiceSlaReport('bs1', '2026-10', viewer, NOW);
    expect(report).not.toHaveProperty('estimatedCostCents');
    expect(report).not.toHaveProperty('currency');
    expect(slaReportCsv(report)).not.toContain('cost');
  });

  it('has no SLO verdict without a target, and 404s an unreadable service', async () => {
    mocks.bs.mockResolvedValueOnce({
      id: 'bs1',
      name: 'C',
      sloTarget: null,
      revenuePerHourCents: null,
      currency: 'USD',
    });
    expect((await getBusinessServiceSlaReport('bs1', '2026-10', admin, NOW)).sloMet).toBeNull();
    mocks.bs.mockResolvedValueOnce(null);
    await expect(getBusinessServiceSlaReport('bs1', '2026-10', admin, NOW)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('renders CSV with the summary and incidents, and a PDF document', async () => {
    const report = await getBusinessServiceSlaReport('bs1', '2026-10', admin, NOW);
    const csv = slaReportCsv(report);
    expect(csv).toContain('SLO,Missed');
    expect(csv).toContain('Estimated downtime cost (EUR),6000.00');
    expect(csv).toContain('Payments down');
    expect(slaReportPdf(report).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
