import { describe, expect, it } from 'vitest';
import {
  analyticsParamsKey,
  parseAnalyticsParams,
  toAnalyticsSearchParams,
} from '@/lib/analytics/params';
import { bucketFor, resolveAnalyticsWindow } from '@/lib/analytics/window';
import { percentChange } from '@/lib/analytics/definitions';

const policy = {
  incidentRetentionDays: 90,
  alertRetentionDays: 90,
  logRetentionDays: 90,
  metricsRetentionDays: 90,
  businessHoursTimeZone: 'UTC',
};

describe('parseAnalyticsParams', () => {
  it('defaults to 30 days with comparison on and no filters', () => {
    expect(parseAnalyticsParams({})).toEqual({
      range: '30d',
      compare: true,
      teams: [],
      services: [],
      priorities: [],
      urgency: undefined,
      status: undefined,
      assignee: undefined,
    });
  });

  it('round-trips through search params', () => {
    const cases = [
      'range=7d&team=t1&team=t2&service=s1&urgency=HIGH&status=RESOLVED&assignee=u1&compare=0',
      'from=2026-01-01&to=2026-01-31&priority=P1',
      'assignee=unassigned',
      '',
    ];
    for (const query of cases) {
      const parsed = parseAnalyticsParams(new URLSearchParams(query));
      expect(parseAnalyticsParams(toAnalyticsSearchParams(parsed))).toEqual(parsed);
    }
  });

  it('maps legacy ?window= and ?range= day counts onto presets', () => {
    expect(parseAnalyticsParams({ window: '7' }).range).toBe('7d');
    expect(parseAnalyticsParams({ window: '14' }).range).toBe('30d');
    expect(parseAnalyticsParams({ range: '1' }).range).toBe('24h');
    expect(parseAnalyticsParams({ range: '9999' }).range).toBe('1095d');
  });

  it('drops junk, injection attempts and unknown enum values', () => {
    const parsed = parseAnalyticsParams({
      range: 'forever',
      team: ["x' OR 1=1 --", 'ok_team'],
      urgency: 'URGENT',
      status: 'DELETED',
      assignee: '<script>',
      incident: 'abc',
    });
    expect(parsed).toMatchObject({
      range: '30d',
      teams: ['ok_team'],
      urgency: undefined,
      status: undefined,
      assignee: undefined,
    });
  });

  it('accepts comma lists, de-duplicates and sorts ids so cache keys are stable', () => {
    const a = parseAnalyticsParams({ service: 'b,a,a' });
    const b = parseAnalyticsParams({ service: ['a', 'b'] });
    expect(a.services).toEqual(['a', 'b']);
    expect(analyticsParamsKey(a)).toBe(analyticsParamsKey(b));
  });

  it('treats custom ranges as inclusive calendar days and rejects inverted or huge ones', () => {
    const custom = parseAnalyticsParams({ from: '2026-01-01', to: '2026-01-01' });
    expect(custom.range).toBe('custom');
    expect(custom.to!.getTime() - custom.from!.getTime()).toBe(86_400_000);
    expect(parseAnalyticsParams({ from: '2026-02-01', to: '2026-01-01' }).range).toBe('30d');
    expect(parseAnalyticsParams({ from: '2020-01-01', to: '2026-01-01' }).range).toBe('30d'); // > 3 years
  });
});

describe('resolveAnalyticsWindow', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('builds a half-open window with an adjacent previous window of equal length', () => {
    const window = resolveAnalyticsWindow({
      params: parseAnalyticsParams({ range: '7d' }),
      policy,
      now,
    });
    expect(window.end).toEqual(now);
    expect(window.start).toEqual(new Date('2026-05-25T12:00:00Z'));
    expect(window.previousEnd).toEqual(window.start);
    expect(window.previousStart).toEqual(new Date('2026-05-18T12:00:00Z'));
    expect(window.bucket).toBe('day');
  });

  it('clips to retention and reports it', () => {
    const window = resolveAnalyticsWindow({
      params: parseAnalyticsParams({ range: '365d' }),
      policy,
      now,
    });
    expect(window.isClipped).toBe(true);
    expect(window.start).toEqual(new Date(now.getTime() - 90 * 86_400_000));
  });

  it('drops the previous period when it would reach past retention', () => {
    const clipped = resolveAnalyticsWindow({
      params: parseAnalyticsParams({ range: '90d' }),
      policy,
      now,
    });
    expect(clipped.hasPrevious).toBe(false);
    expect(clipped.previousStart).toEqual(clipped.start);
    expect(clipped.previousEnd).toEqual(clipped.start);
    const fits = resolveAnalyticsWindow({
      params: parseAnalyticsParams({ range: '30d' }),
      policy,
      now,
    });
    expect(fits.hasPrevious).toBe(true);
    expect(fits.previousStart).toEqual(new Date(fits.start.getTime() - 30 * 86_400_000));
  });

  it("runs custom ranges midnight-to-midnight in the viewer's timezone", () => {
    const params = parseAnalyticsParams({ from: '2026-01-01', to: '2026-01-02' });
    const ny = resolveAnalyticsWindow({
      params,
      policy: { ...policy, incidentRetentionDays: 730 },
      userTimeZone: 'America/New_York',
      now,
    });
    expect(ny.start).toEqual(new Date('2026-01-01T05:00:00Z'));
    expect(ny.end).toEqual(new Date('2026-01-03T05:00:00Z'));
    const tokyo = resolveAnalyticsWindow({
      params,
      policy: { ...policy, incidentRetentionDays: 730 },
      userTimeZone: 'Asia/Tokyo',
      now,
    });
    expect(tokyo.start).toEqual(new Date('2025-12-31T15:00:00Z'));
  });

  it('supports 3-year ranges with monthly buckets, still clipped by retention', () => {
    const params = parseAnalyticsParams({ range: '1095d' });
    const long = resolveAnalyticsWindow({
      params,
      policy: { ...policy, incidentRetentionDays: 1095 },
      now,
    });
    expect(long.bucket).toBe('month');
    expect(long.isClipped).toBe(false);
    expect(resolveAnalyticsWindow({ params, policy, now }).isClipped).toBe(true);
  });

  it('falls back to UTC for invalid timezones', () => {
    const window = resolveAnalyticsWindow({
      params: parseAnalyticsParams({}),
      policy: { ...policy, businessHoursTimeZone: "UTC'; DROP TABLE x" },
      userTimeZone: 'Not/AZone',
      now,
    });
    expect(window.timeZone).toBe('UTC');
    expect(window.businessTimeZone).toBe('UTC');
  });

  it('picks hourly, daily or weekly buckets by length', () => {
    expect(bucketFor(86_400_000)).toBe('hour');
    expect(bucketFor(30 * 86_400_000)).toBe('day');
    expect(bucketFor(180 * 86_400_000)).toBe('week');
  });
});

describe('percentChange', () => {
  it('is null when either side is missing or the base is zero', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
  });
});
