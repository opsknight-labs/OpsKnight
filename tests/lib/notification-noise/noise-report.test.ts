import { describe, expect, it } from 'vitest';
import {
  deriveServiceNoise,
  deriveUserNoise,
  type UserNoiseInput,
} from '@/lib/intelligence/ops-insights/producers/notification-noise';
import { opsInsightItemSchema } from '@/lib/intelligence/ops-insights/contract';
import {
  buildNoiseReport,
  noiseWindow,
  share,
  toNoiseDailyRows,
  type NoiseDailyRow,
} from '@/lib/notification-noise/report';

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
      ['A service you cannot open', 1, 0, 0],
    ]);
    expect(report.byHour[2]).toEqual({ hour: 2, pages: 5, acted: 2, autoResolved: 2 });
    expect(report.byHour[14].pages).toBe(7);
  });

  it('rounds shares and never divides by zero', () => {
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBe(0);
  });
});

describe('rollup rows', () => {
  it('maps rollup points to report rows and skips malformed tags', () => {
    const bucket = new Date('2026-11-09T00:00:00Z');
    expect(
      toNoiseDailyRows([
        {
          bucket,
          subjectKey: 'u',
          count: 4,
          sum: 1,
          tags: { serviceId: 's', hour: 3, autoResolved: true },
        },
        {
          bucket,
          subjectKey: 'u',
          count: 2,
          sum: 2,
          tags: { serviceId: 's', hour: 9, autoResolved: false },
        },
        { bucket, subjectKey: 'u', count: 9, sum: 9, tags: { hour: 1 } },
        { bucket, subjectKey: 'u', count: 9, sum: 9, tags: null },
      ])
    ).toEqual([
      { day: '2026-11-09', serviceId: 's', hour: 3, pages: 4, acted: 1, autoResolved: 4 },
      { day: '2026-11-09', serviceId: 's', hour: 9, pages: 2, acted: 2, autoResolved: 0 },
    ]);
  });

  it('covers the last 30 complete UTC days', () => {
    expect(noiseWindow(new Date('2026-11-14T13:00:00Z'))).toEqual({
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-11-14T00:00:00Z'),
    });
  });
});

const input = (overrides: Partial<UserNoiseInput> = {}): UserNoiseInput => ({
  services: [],
  night: { pages: 0, acted: 0, autoResolved: 0 },
  quietHoursEnabled: false,
  endpoints: [],
  ...overrides,
});
const valid = (items: ReturnType<typeof deriveUserNoise>) => {
  for (const item of items) expect(opsInsightItemSchema.safeParse(item).success).toBe(true);
  return items;
};

describe('notification noise producers (pure half)', () => {
  it('suggests a digest for a source rarely acted on or mostly self-resolving, naming no service', () => {
    const items = valid(
      deriveUserNoise(
        input({
          services: [
            { serviceId: 'svc-a', pages: 10, acted: 1, autoResolved: 0 },
            { serviceId: 'svc-b', pages: 10, acted: 8, autoResolved: 6 },
            { serviceId: 'svc-c', pages: 10, acted: 8, autoResolved: 1 },
            { serviceId: 'svc-d', pages: 4, acted: 0, autoResolved: 0 },
          ],
        })
      )
    );
    expect(items.map(item => item.key)).toEqual(['low-value:svc-a', 'low-value:svc-b']);
    expect(items[0].draftHref).toBe('/services/svc-a/notifications');
    expect(JSON.stringify(items)).not.toContain('Payments');
  });

  it('suggests quiet hours for ignored night pages only while quiet hours are off', () => {
    const night = { pages: 6, acted: 1, autoResolved: 0 };
    expect(valid(deriveUserNoise(input({ night }))).map(item => item.key)).toEqual(['quiet-hours']);
    expect(deriveUserNoise(input({ night, quietHoursEnabled: true }))).toEqual([]);
    expect(deriveUserNoise(input({ night: { pages: 6, acted: 3, autoResolved: 0 } }))).toEqual([]);
    expect(deriveUserNoise(input({ night: { pages: 4, acted: 0, autoResolved: 0 } }))).toEqual([]);
  });

  it('flags only endpoints that cannot reach the person', () => {
    const items = valid(
      deriveUserNoise(
        input({
          endpoints: [
            { channel: 'SMS', status: 'BOUNCED', failureCount: 3 },
            { channel: 'EMAIL', status: 'ACTIVE', failureCount: 0 },
            { channel: 'PUSH', status: 'DEGRADED', failureCount: 1 },
          ],
        })
      )
    );
    expect(items.map(item => [item.key, item.severity])).toEqual([
      ['endpoint:SMS', 'CRITICAL'],
      ['endpoint:PUSH', 'WARNING'],
    ]);
  });

  it('judges a service over everyone it paged, with a higher floor', () => {
    const counts = { serviceId: 's', pages: 20, acted: 2, autoResolved: 0 };
    expect(valid(deriveServiceNoise(counts)).map(item => item.key)).toEqual(['low-value']);
    expect(deriveServiceNoise({ ...counts, pages: 19 })).toEqual([]);
    expect(deriveServiceNoise({ ...counts, acted: 15 })).toEqual([]);
  });
});
