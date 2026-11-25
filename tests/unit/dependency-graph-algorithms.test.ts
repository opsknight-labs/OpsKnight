import { describe, expect, it } from 'vitest';
import {
  derivedDependencyStatuses,
  describeEvidence,
  findCycles,
  wouldCreateCycle,
} from '@/lib/intelligence/dependencies/graph';

// "downstream depends on upstream"
const dep = (downstream: string, upstream: string) => ({
  downstreamServiceId: downstream,
  upstreamServiceId: upstream,
});

describe('wouldCreateCycle', () => {
  const chain = [dep('web', 'api'), dep('api', 'db')];
  it('rejects a self dependency', () => {
    expect(wouldCreateCycle([], dep('a', 'a'))).toEqual(['a', 'a']);
  });
  it('finds the closing path when the upstream already depends on the downstream', () => {
    // db depending on web would close web -> api -> db -> web
    expect(wouldCreateCycle(chain, dep('db', 'web'))).toEqual(['db', 'web', 'api', 'db']);
  });
  it('allows an edge that only adds a shortcut', () => {
    expect(wouldCreateCycle(chain, dep('web', 'db'))).toBeNull();
  });
  it('terminates on a graph that already contains a cycle', () => {
    expect(wouldCreateCycle([dep('a', 'b'), dep('b', 'a')], dep('c', 'a'))).toBeNull();
  });
});

describe('findCycles', () => {
  it('returns nothing for a DAG', () => {
    expect(findCycles([dep('a', 'b'), dep('b', 'c'), dep('a', 'c')])).toEqual([]);
  });
  it('returns each strongly connected component once, sorted', () => {
    const cycles = findCycles([
      dep('a', 'b'),
      dep('b', 'c'),
      dep('c', 'a'),
      dep('x', 'y'),
      dep('y', 'x'),
      dep('z', 'a'),
    ]);
    expect(cycles.map(c => c.join(',')).sort()).toEqual(['a,b,c', 'x,y']);
  });
  it('reports a self loop and respects the limit', () => {
    expect(findCycles([dep('s', 's')])).toEqual([['s']]);
    expect(
      findCycles([dep('a', 'b'), dep('b', 'a'), dep('c', 'd'), dep('d', 'c')], 1)
    ).toHaveLength(1);
  });
  it('handles a long chain without overflowing the stack', () => {
    const edges = Array.from({ length: 20000 }, (_, i) => dep(`n${i}`, `n${i + 1}`));
    expect(findCycles(edges)).toEqual([]);
  });
});

describe('derivedDependencyStatuses', () => {
  const edges = [dep('web', 'api'), dep('api', 'db'), dep('batch', 'db'), dep('far', 'web')];
  it('marks dependents within depth with a capped status and skips sources', () => {
    const result = derivedDependencyStatuses(
      edges,
      new Map([['db', { incidentId: 'i1', urgency: 'HIGH' as const }]]),
      2
    );
    expect(result.get('api')).toEqual({
      status: 'PARTIAL_OUTAGE',
      incidentId: 'i1',
      serviceId: 'db',
      depth: 1,
    });
    expect(result.get('web')?.depth).toBe(2);
    expect(result.has('far')).toBe(false); // depth 3 > 2
    expect(result.has('db')).toBe(false);
  });
  it('maps LOW urgency to DEGRADED and keeps the worst of several sources', () => {
    const result = derivedDependencyStatuses(
      edges,
      new Map([
        ['db', { incidentId: 'i1', urgency: 'LOW' as const }],
        ['api', { incidentId: 'i2', urgency: 'MEDIUM' as const }],
      ])
    );
    expect(result.get('batch')?.status).toBe('DEGRADED');
    expect(result.get('web')?.status).toBe('PARTIAL_OUTAGE');
    expect(result.has('api')).toBe(false);
  });
});

describe('describeEvidence', () => {
  it('reads declared and co-occurrence evidence, nothing else', () => {
    expect(describeEvidence({ type: 'declared' })).toBe('Declared by an operator');
    expect(describeEvidence({ type: 'declared', source: 'import' })).toBe(
      'Declared by an operator (import)'
    );
    expect(
      describeEvidence({
        type: 'co_occurrence',
        coOccurrences: 3,
        windowMinutes: 10,
        lookbackDays: 30,
      })
    ).toBe('Incidents opened together 3 times within 10 min over 30 days');
    expect(describeEvidence({ type: 'weird' })).toBeNull();
    expect(describeEvidence(null)).toBeNull();
    expect(describeEvidence([1])).toBeNull();
  });
});
