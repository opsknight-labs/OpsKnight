import { describe, expect, it } from 'vitest';
import {
  describeMetricChange,
  explainMetricChange,
  type ServicePeriod,
} from '@/lib/intelligence/helpers/metric-change';

const MIN = 60_000;
const p = (count: number, ackMin = 0, acks = 0, resolveMin = 0, resolves = 0): ServicePeriod => ({
  count,
  ackSum: ackMin * MIN,
  ackCount: acks,
  resolveSum: resolveMin * MIN,
  resolveCount: resolves,
});
const map = (entries: Record<string, ServicePeriod>) => new Map(Object.entries(entries));
const names = new Map([
  ['pay', 'payments'],
  ['chk', 'checkout'],
  ['web', 'web'],
  ['db', 'database'],
]);

describe('explainMetricChange', () => {
  it('splits an incident rise into per-service differences, largest first, only those that rose', () => {
    const change = explainMetricChange(
      'incidents',
      map({ pay: p(15), chk: p(7), web: p(1) }),
      map({ pay: p(3), chk: p(2), web: p(4), db: p(1) })
    )!;
    expect(change).toMatchObject({ direction: 'up', current: 23, previous: 10 });
    expect(change.contributors).toEqual([
      { serviceId: 'pay', delta: 12 },
      { serviceId: 'chk', delta: 5 },
    ]);
    // 17 of a 13 net rise: offsetting drops elsewhere make the listed share exceed 1.
    expect(change.share).toBeCloseTo(17 / 13);
    expect(describeMetricChange(change, names)).toBe('Most of the rise: payments +12, checkout +5');
  });

  it('decomposes a mean exactly, so the terms add up to the change in MTTA', () => {
    const current = map({ pay: p(0, 300, 10), chk: p(0, 100, 10) }); // mean 20m
    const previous = map({ pay: p(0, 100, 10), chk: p(0, 100, 10) }); // mean 10m
    const change = explainMetricChange('mtta', current, previous)!;
    expect(change.current).toBeCloseTo(20);
    expect(change.previous).toBeCloseTo(10);
    // pay: 300/20 - 100/20 = 10 minutes; chk: 100/20 - 100/20 = 0, so only pay is listed.
    expect(change.contributors).toEqual([{ serviceId: 'pay', delta: 10 }]);
    expect(describeMetricChange(change, names)).toBe('Most of the rise: payments +10m');
  });

  it('reports a drop and formats long durations in hours', () => {
    const change = explainMetricChange(
      'mttr',
      map({ pay: p(0, 0, 0, 60, 1) }),
      map({ pay: p(0, 0, 0, 240, 1) })
    )!;
    expect(change.direction).toBe('down');
    expect(describeMetricChange(change, names)).toBe('Most of the drop: payments −3.0h');
  });

  it('says the change is spread out when the top services explain less than half of it', () => {
    const current = map(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, p(2)])));
    const previous = map(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, p(1)])));
    const change = explainMetricChange('incidents', current, previous)!;
    expect(change.contributors).toHaveLength(3);
    expect(describeMetricChange(change, new Map())).toMatch(
      /^Spread across services; largest: a removed service \+1/
    );
  });

  it('has nothing to explain without a change or without a previous mean', () => {
    expect(explainMetricChange('incidents', map({ pay: p(3) }), map({ pay: p(3) }))).toBeNull();
    expect(explainMetricChange('mtta', map({ pay: p(1, 5, 1) }), map({}))).toBeNull();
    expect(explainMetricChange('incidents', map({}), map({}))).toBeNull();
  });
});
