import { describe, expect, it } from 'vitest';
import {
  articulationPoints,
  diffEdges,
  diffStatuses,
  fanOut,
  replayEdges,
  type EdgeEvent,
} from '@/lib/intelligence/dependencies/insights/analysis';

const t = (day: number) => new Date(Date.UTC(2026, 10, day));
const ev = (
  up: string,
  down: string,
  state: EdgeEvent['state'],
  day: number,
  origin: EdgeEvent['origin'] = 'DECLARED'
): EdgeEvent => ({
  upstreamServiceId: up,
  downstreamServiceId: down,
  state,
  origin,
  occurredAt: t(day),
});

describe('replayEdges', () => {
  const events = [
    ev('db', 'api', 'SUGGESTED', 1, 'OBSERVED'),
    ev('db', 'api', 'ACTIVE', 3),
    ev('db', 'api', 'REMOVED', 8),
    ev('cache', 'api', 'ACTIVE', 5),
  ];
  it('uses the latest event at or before the moment', () => {
    expect(replayEdges(events, t(2)).get('db>api')?.state).toBe('SUGGESTED');
    expect(replayEdges(events, t(4)).get('db>api')?.state).toBe('ACTIVE');
    expect(replayEdges(events, t(9)).has('db>api')).toBe(false);
  });
  it('ignores the future and tolerates unordered input', () => {
    expect([...replayEdges([...events].reverse(), t(6)).keys()].sort()).toEqual(['cache>api', 'db>api']);
    expect(replayEdges(events, t(0)).size).toBe(0);
  });
  it('treats rejected edges as absent', () => {
    expect(replayEdges([ev('a', 'b', 'REJECTED', 1)], t(2)).size).toBe(0);
  });
});

describe('diffEdges and diffStatuses', () => {
  const events = [ev('db', 'api', 'ACTIVE', 1), ev('q', 'api', 'ACTIVE', 1), ev('q', 'api', 'REMOVED', 6),
    ev('c', 'api', 'ACTIVE', 7), ev('x', 'api', 'SUGGESTED', 7, 'OBSERVED')];
  it('reports added, removed and newly suggested edges', () => {
    const diff = diffEdges(replayEdges(events, t(3)), replayEdges(events, t(9)));
    expect(diff.added.map(e => e.upstreamServiceId)).toEqual(['c']);
    expect(diff.removed.map(e => e.upstreamServiceId)).toEqual(['q']);
    expect(diff.newlySuggested.map(e => e.upstreamServiceId)).toEqual(['x']);
  });
  it('lists only services present in both with a changed status', () => {
    expect(
      diffStatuses(new Map([['a', 'OK'], ['b', 'OK']]), new Map([['a', 'BAD'], ['b', 'OK'], ['c', 'BAD']]))
    ).toEqual([{ id: 'a', from: 'OK', to: 'BAD' }]);
  });
});

describe('fanOut', () => {
  it('counts transitive dependents and survives cycles', () => {
    const edges = [
      { upstreamServiceId: 'db', downstreamServiceId: 'api' },
      { upstreamServiceId: 'api', downstreamServiceId: 'web' },
      { upstreamServiceId: 'web', downstreamServiceId: 'api' },
    ];
    const result = fanOut(edges, ['db', 'web']);
    expect([...result.get('db')!].sort()).toEqual(['api', 'web']);
    expect([...result.get('web')!]).toEqual(['api']);
  });
});

describe('articulationPoints', () => {
  const e = (a: string, b: string) => ({ upstreamServiceId: a, downstreamServiceId: b });
  it('finds the bridge service of a chain, not its ends', () => {
    expect(articulationPoints([e('a', 'b'), e('b', 'c')])).toEqual(['b']);
  });
  it('finds none in a cycle and handles a star root', () => {
    expect(articulationPoints([e('a', 'b'), e('b', 'c'), e('a', 'c')])).toEqual([]);
    expect(articulationPoints([e('hub', 'x'), e('hub', 'y'), e('hub', 'z')])).toEqual(['hub']);
  });
  it('works per component and terminates on a long chain', () => {
    const chain = Array.from({ length: 5000 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    expect(articulationPoints(chain)).toHaveLength(4999);
    expect(articulationPoints([e('a', 'b'), e('c', 'd')])).toEqual([]);
  });
});
