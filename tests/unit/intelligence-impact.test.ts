import { describe, expect, it } from 'vitest';
import { downstreamDistances } from '@/lib/intelligence/dependencies/graph';
import { objectiveBudgetMinutes } from '@/lib/slo/burn';
import { isImpactEmpty } from '@/lib/intelligence/impact/view';

const edge = (upstream: string, downstream: string) => ({
  upstreamServiceId: upstream,
  downstreamServiceId: downstream,
});

describe('downstreamDistances', () => {
  it('walks dependents transitively with the shortest distance, cycles included', () => {
    const edges = [edge('db', 'api'), edge('api', 'web'), edge('db', 'web'), edge('web', 'db')];
    const { distances, truncated } = downstreamDistances(edges, 'db', 3);
    expect([...distances.entries()].sort()).toEqual([
      ['api', 1],
      ['web', 1],
    ]);
    expect(truncated).toBe(false);
  });

  it('respects the depth cap and reports a node cap as truncated', () => {
    const chain = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e')];
    expect([...downstreamDistances(chain, 'a', 2).distances.keys()]).toEqual(['b', 'c']);
    const hub = Array.from({ length: 10 }, (_, i) => edge('hub', `s${i}`));
    const capped = downstreamDistances(hub, 'hub', 3, 4);
    expect(capped.distances.size).toBe(4);
    expect(capped.truncated).toBe(true);
  });
});

describe('objectiveBudgetMinutes', () => {
  it('derives the whole-window budget from target and window', () => {
    expect(objectiveBudgetMinutes(99.9, 'THIRTY_DAYS', null)).toBeCloseTo(43.2, 1);
    expect(objectiveBudgetMinutes(99, 'SEVEN_DAYS', null)).toBeCloseTo(100.8, 1);
    expect(objectiveBudgetMinutes(99.9, 'ROLLING_DAYS', 14)).toBeCloseTo(20.2, 1);
    expect(objectiveBudgetMinutes(99.9, 'YEARLY', null)).toBeCloseTo(525.6, 1);
    expect(objectiveBudgetMinutes(100, 'THIRTY_DAYS', null)).toBeNull();
  });
});

describe('isImpactEmpty', () => {
  const base = {
    serviceId: 's',
    downstream: [],
    downstreamTruncated: false,
    components: [],
    componentsTruncated: false,
  };
  it('is empty only when nothing applies', () => {
    expect(isImpactEmpty({ ...base, slo: { state: 'NONE' } })).toBe(true);
    expect(isImpactEmpty({ ...base, slo: { state: 'RESTRICTED' } })).toBe(true);
    expect(isImpactEmpty({ ...base, slo: { state: 'UNAVAILABLE' } })).toBe(false);
    expect(
      isImpactEmpty({
        ...base,
        slo: { state: 'NONE' },
        downstream: [{ id: 'x', name: 'X', distance: 1, status: 'OPERATIONAL', openIncidents: 0 }],
      })
    ).toBe(false);
  });
});
