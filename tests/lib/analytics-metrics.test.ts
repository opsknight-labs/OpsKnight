import { describe, it, expect } from 'vitest';
import {
  buildOnCallLoad,
  buildServiceSlaTable,
  buildStatusAges,
  calculateMtbfMs,
  calculatePercentile,
  smoothSeries,
} from '@/lib/analytics-metrics';

describe('analytics-metrics utilities', () => {
  it('calculates percentiles for sorted values with interpolation and NaN filtering', () => {
    const values = [10, 20, 30, 40, 50];
    expect(calculatePercentile(values, 50)).toBe(30);
    expect(calculatePercentile(values, 0)).toBe(10);
    expect(calculatePercentile(values, 100)).toBe(50);
    expect(calculatePercentile([10, NaN, 20, 30], 50)).toBe(20);
    expect(calculatePercentile([], 50)).toBeNull();
  });

  it('calculates MTBF from incident timestamps and window bounds', () => {
    const dates = [
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-01T01:00:00Z'),
      new Date('2025-01-01T03:00:00Z'),
    ];
    const mtbf = calculateMtbfMs(dates);
    expect(mtbf).toBe(3600000);

    const windowStart = new Date('2025-01-01T00:00:00Z');
    const windowEnd = new Date('2025-01-02T00:00:00Z'); // 24h
    expect(calculateMtbfMs(dates, windowStart, windowEnd)).toBe(86400000 / 3);
  });

  it('builds status age averages', () => {
    const now = new Date('2025-01-02T00:00:00Z');
    const incidents = [
      { status: 'OPEN', createdAt: new Date('2025-01-01T00:00:00Z') },
      {
        status: 'RESOLVED',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        resolvedAt: new Date('2025-01-01T06:00:00Z'),
      },
    ];
    const ages = buildStatusAges(incidents, now, ['OPEN', 'RESOLVED']);
    expect(ages[0].avgMs).toBe(86400000);
    expect(ages[1].avgMs).toBe(21600000);
  });

  it('builds on-call load totals', () => {
    const shifts = [
      {
        userId: 'u1',
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-01T06:00:00Z'),
      },
      {
        userId: 'u2',
        start: new Date('2025-01-01T06:00:00Z'),
        end: new Date('2025-01-01T12:00:00Z'),
      },
    ];
    const incidents = [
      { createdAt: new Date('2025-01-01T01:00:00Z') },
      { createdAt: new Date('2025-01-01T07:00:00Z') },
    ];
    const userNameMap = new Map<string, string>([
      ['u1', 'User One'],
      ['u2', 'User Two'],
    ]);
    const load = buildOnCallLoad(
      shifts,
      incidents,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-01T12:00:00Z'),
      userNameMap
    );
    expect(load).toHaveLength(2);
    expect(load[0].incidentCount + load[1].incidentCount).toBe(2);
  });

  it('builds service SLA compliance table', () => {
    const incidents = [
      {
        id: 'i1',
        serviceId: 's1',
        status: 'RESOLVED',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        resolvedAt: new Date('2025-01-01T01:00:00Z'),
        updatedAt: null,
      },
      {
        id: 'i2',
        serviceId: 's1',
        status: 'OPEN',
        createdAt: new Date('2025-01-01T02:00:00Z'),
        resolvedAt: null,
        updatedAt: null,
      },
    ];
    const ackMap = new Map<string, Date>([['i1', new Date('2025-01-01T00:10:00Z')]]);
    const targets = new Map<string, { ackMinutes: number; resolveMinutes: number }>([
      ['s1', { ackMinutes: 15, resolveMinutes: 90 }],
    ]);
    const names = new Map<string, string>([['s1', 'Service One']]);
    const table = buildServiceSlaTable(incidents, ackMap, targets, names);
    // i2 is still open and well beyond the 15-minute acknowledgement target,
    // so it belongs in the denominator as a breach rather than disappearing.
    expect(table[0].ackRate).toBe(50);
    expect(table[0].resolveRate).toBe(50);
  });

  it('smooths series with trailing window average', () => {
    const values = [2, 4, 6, 8];
    expect(smoothSeries(values, 1)).toEqual(values);
    expect(smoothSeries(values, 2)).toEqual([2, 3, 5, 7]);
    expect(smoothSeries(values, 3)).toEqual([2, 3, 4, 6]);
  });
});
