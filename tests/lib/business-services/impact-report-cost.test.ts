import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
import {
  compareImpactRows,
  impactReportCsv,
  impactReportSearch,
  parseImpactReportParams,
  type ImpactReport,
  type ImpactReportRow,
} from '@/lib/business-services/impact-report';

const row = (
  name: string,
  impactMinutes: number,
  estimatedCostCents: number | null,
  extra: Partial<ImpactReportRow> = {}
): ImpactReportRow => ({
  id: name,
  name,
  criticality: 'TIER_1',
  ownerTeam: null,
  revenuePerHourCents: null,
  currency: 'USD',
  customersTotal: null,
  estimatedCostCents,
  worstMember: null,
  stats: {
    window: { from: new Date(0), to: new Date(1) },
    impactMinutes,
    uptimePercent: 99.5,
    incidentCount: 1,
    mttaMinutes: null,
    mttrMinutes: null,
  },
  ...extra,
});

describe('impact report ranking', () => {
  const rows = [
    row('b-cheap', 600, 1_000),
    row('a-pricey', 60, 900_000),
    row('c-unpriced', 300, null),
  ];
  it('ranks by impacted time by default', () => {
    expect([...rows].sort(compareImpactRows()).map(r => r.name)).toEqual([
      'b-cheap',
      'c-unpriced',
      'a-pricey',
    ]);
  });
  it('ranks by estimated cost, with unpriced services last', () => {
    expect([...rows].sort(compareImpactRows('cost')).map(r => r.name)).toEqual([
      'a-pricey',
      'b-cheap',
      'c-unpriced',
    ]);
  });
  it('breaks cost ties by impact then name', () => {
    const tied = [row('z', 10, 5), row('a', 10, 5), row('m', 99, 5)];
    expect([...tied].sort(compareImpactRows('cost')).map(r => r.name)).toEqual(['m', 'a', 'z']);
  });
});

describe('impact report params and CSV', () => {
  it('round-trips the sort option and ignores unknown values', () => {
    expect(parseImpactReportParams(new URLSearchParams('sort=cost')).sort).toBe('cost');
    expect(parseImpactReportParams(new URLSearchParams('sort=drop')).sort).toBe('impact');
    expect(impactReportSearch({ days: 30, teamId: null, tier: null, sort: 'cost' })).toBe(
      'sort=cost'
    );
    expect(impactReportSearch({ days: 30, teamId: null, tier: null, sort: 'impact' })).toBe('');
  });
  it('exports cost in major units with currency and customers, blank when unpriced', () => {
    const report: ImpactReport = {
      window: { from: new Date(0), to: new Date(1) },
      params: { days: 30, teamId: null, tier: null },
      truncated: false,
      rows: [
        row('Priced', 90, 123_456, { currency: 'EUR', customersTotal: 5000 }),
        row('Unpriced', 10, null),
      ],
    };
    const [header, priced, unpriced] = impactReportCsv(report).trim().split('\n');
    expect(header.endsWith('Estimated cost,Currency,Customers exposed')).toBe(true);
    expect(priced.endsWith(',1234.56,EUR,5000')).toBe(true);
    expect(unpriced.endsWith(',,,')).toBe(true);
  });
});
