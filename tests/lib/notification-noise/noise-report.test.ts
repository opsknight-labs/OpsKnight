import { describe, expect, it } from 'vitest';
import {
  lowValueSourceInsights,
  notificationNoiseInsights,
  quietHoursInsights,
  unhealthyEndpointInsights,
} from '@/lib/notification-noise/insights';
import { buildNoiseReport, share, type NoiseDailyRow } from '@/lib/notification-noise/report';

const row = (overrides: Partial<NoiseDailyRow>): NoiseDailyRow => ({
  day: '2026-11-10',
  serviceId: 'svc-a',
  hour: 10,
  pages: 1,
  acted: 0,
  autoResolved: 0,
  ...overrides,
});
const names = new Map([
  ['svc-a', 'Payments'],
  ['svc-b', 'Search'],
]);

describe('noise report', () => {
  it('is empty and still 24 hours wide when there were no pages', () => {
    const report = buildNoiseReport([], names);
    expect(report).toMatchObject({ days: 30, pages: 0, acted: 0, autoResolved: 0, byService: [] });
    expect(report.byHour).toHaveLength(24);
  });

  it('adds days up per service and per local hour, busiest service first', () => {
    const report = buildNoiseReport(
      [
        row({ day: '2026-11-09', hour: 2, pages: 3, acted: 1, autoResolved: 2 }),
        row({ day: '2026-11-10', hour: 2, pages: 2, acted: 1 }),
        row({ serviceId: 'svc-b', hour: 14, pages: 7, acted: 7 }),
        row({ serviceId: 'svc-gone', hour: 23, pages: 1 }),
        // Malformed rows are ignored rather than corrupting a bucket.
        row({ hour: 24, pages: 9 }),
        row({ pages: 0, acted: 5 }),
      ],
      names
    );
    expect(report).toMatchObject({ pages: 13, acted: 9, autoResolved: 2 });
    expect(report.byService.map(s => [s.serviceName, s.pages, s.acted, s.autoResolved])).toEqual([
      ['Search', 7, 7, 0],
      ['Payments', 5, 2, 2],
      ['Unknown service', 1, 0, 0],
    ]);
    expect(report.byHour[2]).toEqual({ hour: 2, pages: 5, acted: 2, autoResolved: 2 });
    expect(report.byHour[14].pages).toBe(7);
  });

  it('rounds shares and never divides by zero', () => {
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBe(0);
  });
});

describe('noise insights', () => {
  const noisy = buildNoiseReport(
    [
      // Payments: 10 pages, 1 acted on -> low value.
      row({ hour: 3, pages: 6, acted: 0 }),
      row({ hour: 23, pages: 4, acted: 1 }),
      // Search: 10 pages, all acted on, but 6 resolved by themselves -> low value.
      row({ serviceId: 'svc-b', hour: 11, pages: 10, acted: 10, autoResolved: 6 }),
      // Too few pages to be a pattern.
      row({ serviceId: 'svc-c', hour: 12, pages: 4, acted: 0 }),
    ],
    names
  );

  it('flags a source that is rarely acted on or mostly resolves by itself', () => {
    const items = lowValueSourceInsights(noisy);
    expect(items.map(item => item.key).sort()).toEqual(['svc-a', 'svc-b']);
    const payments = items.find(item => item.key === 'svc-a')!;
    expect(payments).toMatchObject({
      kind: 'notification.low_value_source',
      severity: 'INFO',
      draftHref: '/services/svc-a/notifications',
    });
    expect(payments.evidence.facts[1]).toEqual({ label: 'Acted on', value: '1 (10%)' });
  });

  it('says nothing about a source the person acts on', () => {
    const healthy = buildNoiseReport([row({ pages: 20, acted: 15, autoResolved: 2 })], names);
    expect(lowValueSourceInsights(healthy)).toEqual([]);
  });

  it('suggests quiet hours for ignored night pages, only while quiet hours are off', () => {
    const [item] = quietHoursInsights(noisy, { quietHoursEnabled: false });
    expect(item).toMatchObject({
      kind: 'notification.quiet_hours',
      draftHref: '/settings/profile?tab=schedule',
    });
    expect(item.evidence.facts[0].value).toBe('10');
    expect(quietHoursInsights(noisy, { quietHoursEnabled: true })).toEqual([]);
  });

  it('does not suggest quiet hours when night pages are acted on or rare', () => {
    const acted = buildNoiseReport([row({ hour: 2, pages: 10, acted: 8 })], names);
    const rare = buildNoiseReport([row({ hour: 2, pages: 4, acted: 0 })], names);
    const daytime = buildNoiseReport([row({ hour: 13, pages: 30, acted: 0 })], names);
    for (const report of [acted, rare, daytime]) {
      expect(quietHoursInsights(report, { quietHoursEnabled: false })).toEqual([]);
    }
  });

  it('flags only endpoints that cannot reach the person', () => {
    const items = unhealthyEndpointInsights([
      { channel: 'EMAIL', status: 'HEALTHY', failureCount: 0 },
      { channel: 'PUSH', status: 'UNVERIFIED', failureCount: 0 },
      { channel: 'SMS', status: 'DEGRADED', failureCount: 3, lastErrorCode: '30003' },
      { channel: 'VOICE', status: 'INVALID', failureCount: 5 },
    ]);
    expect(items.map(item => [item.key, item.severity])).toEqual([
      ['SMS', 'WARNING'],
      ['VOICE', 'CRITICAL'],
    ]);
    expect(items[0].evidence.facts).toContainEqual({ label: 'Last error', value: '30003' });
  });

  it('returns nothing when there is nothing to say, and the most severe first otherwise', () => {
    expect(
      notificationNoiseInsights({
        report: buildNoiseReport([], names),
        quietHoursEnabled: false,
        endpoints: [],
      })
    ).toEqual([]);
    const all = notificationNoiseInsights({
      report: noisy,
      quietHoursEnabled: false,
      endpoints: [{ channel: 'VOICE', status: 'BOUNCED', failureCount: 2 }],
    });
    expect(all[0]).toMatchObject({ kind: 'notification.unhealthy_endpoint', severity: 'CRITICAL' });
    expect(all).toHaveLength(4);
    // Every item fits the shared insight limits.
    for (const item of all) {
      expect(item.title.length).toBeLessThanOrEqual(140);
      expect(item.summary.length).toBeLessThanOrEqual(400);
      expect(item.draftHref).toMatch(/^\/(?!\/)/);
    }
  });
});
