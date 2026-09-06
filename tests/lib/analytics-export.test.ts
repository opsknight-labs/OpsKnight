import { describe, it, expect } from 'vitest';
import { buildAnalyticsExportUrl } from '@/lib/analytics-export';

describe('buildAnalyticsExportUrl', () => {
  it('builds a url with only window', () => {
    const url = buildAnalyticsExportUrl({ windowDays: 7 });
    expect(url).toBe('/api/analytics/export?format=csv&window=7');
  });

  it('includes all provided filters', () => {
    const url = buildAnalyticsExportUrl({
      windowDays: 14,
      teamId: 'team-1',
      serviceId: 'service-1',
      assigneeId: 'user-1',
      status: 'OPEN',
      urgency: 'HIGH',
    });
    expect(url).toBe(
      '/api/analytics/export?format=csv&window=14&team=team-1&service=service-1&assignee=user-1&status=OPEN&urgency=HIGH'
    );
  });

  it('skips ALL values', () => {
    const url = buildAnalyticsExportUrl({
      windowDays: 30,
      teamId: 'ALL',
      serviceId: 'ALL',
      assigneeId: 'ALL',
    });
    expect(url).toBe('/api/analytics/export?format=csv&window=30');
  });
});
