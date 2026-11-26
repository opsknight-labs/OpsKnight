import { describe, expect, it } from 'vitest';
import { reportMonths } from '@/components/business-service/SlaReportMenu';

describe('reportMonths', () => {
  it('offers this month and the previous one in UTC, across a year boundary', () => {
    expect(reportMonths(new Date('2026-11-26T12:00:00Z'))).toEqual(['2026-11', '2026-10']);
    expect(reportMonths(new Date('2027-01-03T00:00:00Z'))).toEqual(['2027-01', '2026-12']);
  });
});
