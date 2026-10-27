import { describe, expect, it } from 'vitest';
import { upstreamDistances } from '@/lib/intelligence/dependencies/graph';
import { scoreCause } from '@/lib/intelligence/root-cause/scoring';
import { rankRunbooks, wilsonLowerBound } from '@/lib/intelligence/recommendations/wilson';
import { RESPONSE_LIMITS } from '@/lib/intelligence/contract';

const edge = (downstream: string, upstream: string) => ({ downstreamServiceId: downstream, upstreamServiceId: upstream });

describe('upstreamDistances', () => {
  it('walks transitively with the shortest distance and excludes the start', () => {
    const edges = [edge('web', 'api'), edge('api', 'db'), edge('web', 'db')];
    expect(upstreamDistances(edges, 'web', 3)).toEqual(new Map([['api', 1], ['db', 1]]));
    expect(upstreamDistances([edge('web', 'api'), edge('api', 'db')], 'web', 3)).toEqual(
      new Map([['api', 1], ['db', 2]])
    );
  });

  it('terminates on cycles and never returns the start service', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    const result = upstreamDistances(edges, 'a', 10);
    expect([...result.keys()].sort()).toEqual(['b', 'c']);
  });

  it('respects the depth cap', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
    expect([...upstreamDistances(edges, 'a', 2).keys()]).toEqual(['b', 'c']);
    expect(upstreamDistances(edges, 'a', 0).size).toBe(0);
  });
});

describe('scoreCause', () => {
  const base = { relation: 'SAME_SERVICE', depth: 0, kind: 'DEPLOY' } as const;

  it('scores recent changes higher than older ones', () => {
    const recent = scoreCause({ ...base, leadSeconds: 60 }).confidence;
    const older = scoreCause({ ...base, leadSeconds: 3 * 3600 }).confidence;
    expect(recent).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(0);
  });

  it('ranks same service above upstream above global at equal timing', () => {
    const lead = 600;
    const same = scoreCause({ ...base, leadSeconds: lead }).confidence;
    const up1 = scoreCause({ ...base, relation: 'UPSTREAM', depth: 1, leadSeconds: lead }).confidence;
    const up3 = scoreCause({ ...base, relation: 'UPSTREAM', depth: 3, leadSeconds: lead }).confidence;
    const global = scoreCause({ ...base, relation: 'GLOBAL', leadSeconds: lead }).confidence;
    expect(same).toBeGreaterThan(up1);
    expect(up1).toBeGreaterThan(up3);
    expect(up1).toBeGreaterThan(global);
  });

  it('never reaches certainty and rejects out-of-window or future candidates', () => {
    expect(scoreCause({ ...base, leadSeconds: 0 }).confidence).toBeLessThanOrEqual(RESPONSE_LIMITS.maxCauseConfidence);
    expect(scoreCause({ ...base, leadSeconds: -1 }).confidence).toBe(0);
    expect(scoreCause({ ...base, leadSeconds: RESPONSE_LIMITS.causeLookbackMinutes * 60 + 1 }).confidence).toBe(0);
    expect(scoreCause({ ...base, leadSeconds: Number.NaN }).confidence).toBe(0);
  });
});

describe('wilsonLowerBound and rankRunbooks', () => {
  it('is conservative for tiny samples and approaches the rate for large ones', () => {
    expect(wilsonLowerBound(1, 1)).toBeLessThan(0.5);
    expect(wilsonLowerBound(47, 50)).toBeGreaterThan(0.8);
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(5, 4)).toBeLessThanOrEqual(1);
  });

  it('ranks a proven runbook above a lucky one-off, and proven above untried', () => {
    const ranked = rankRunbooks(
      [
        { runbookId: 'lucky', succeeded: 1, eligible: 1, bound: false },
        { runbookId: 'proven', succeeded: 47, eligible: 50, bound: false },
        { runbookId: 'untried', succeeded: 0, eligible: 0, bound: true },
      ],
      5
    );
    expect(ranked.map(r => r.runbookId)).toEqual(['proven', 'lucky', 'untried']);
    expect(rankRunbooks(ranked, 2)).toHaveLength(2);
  });

  it('breaks ties deterministically, preferring bound runbooks', () => {
    const ranked = rankRunbooks(
      [
        { runbookId: 'b', succeeded: 0, eligible: 0, bound: true },
        { runbookId: 'a', succeeded: 0, eligible: 0, bound: true },
      ],
      5
    );
    expect(ranked.map(r => r.runbookId)).toEqual(['a', 'b']);
  });
});
