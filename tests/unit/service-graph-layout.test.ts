import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import {
  fromElkGraph,
  gridLayout,
  runLayout,
  toElkGraph,
  type LayoutRequest,
} from '@/components/service-graph/layout';
import { formatGraphFocus, nodesWithinHops, parseGraphFocus } from '@/lib/service-graph/focus';

/** A realistic service estate: teams of services, each depending on a few earlier services. */
function estate(count: number, teams: number, grouped: boolean): LayoutRequest {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    width: 180,
    height: 52,
    group: `t${index % teams}`,
  }));
  const edges = [];
  for (let index = 1; index < count; index += 1) {
    for (let k = 0; k < 2; k += 1) {
      const target = Math.floor(random() * index);
      edges.push({ id: `e${index}-${k}`, source: `n${index}`, target: `n${target}` });
    }
  }
  return { nodes, edges, grouped };
}

describe('service graph layout', () => {
  it('lays out 2000 nodes in under 1.5 s (team grouping, as the full view uses above 300)', async () => {
    const elk = new ELK();
    const request = estate(2000, 40, true);
    const started = performance.now();
    const result = await runLayout(elk, request);
    const elapsed = performance.now() - started;
    expect(Object.keys(result.positions)).toHaveLength(2000);
    expect(result.groups).toHaveLength(40);
    expect(elapsed).toBeLessThan(1500);
  }, 20_000);

  it('places dependencies to the right of their dependents', async () => {
    const result = await runLayout(new ELK(), {
      nodes: ['bs', 'web', 'db'].map(id => ({ id, width: 100, height: 40 })),
      edges: [
        { id: 'a', source: 'bs', target: 'web' },
        { id: 'b', source: 'web', target: 'db' },
      ],
      grouped: false,
    });
    expect(result.positions.bs.x).toBeLessThan(result.positions.web.x);
    expect(result.positions.web.x).toBeLessThan(result.positions.db.x);
  });

  it('converts group-relative positions to absolute ones', () => {
    const graph = toElkGraph(estate(4, 2, true));
    expect(graph.children?.map(child => child.id)).toEqual(['group:t0', 'group:t1']);
    const result = fromElkGraph({
      id: 'root',
      children: [{ id: 'group:t0', x: 100, y: 50, children: [{ id: 'n0', x: 10, y: 5 }] }],
    });
    expect(result.positions.n0).toEqual({ x: 110, y: 55 });
    expect(result.groups[0]).toMatchObject({ id: 'group:t0', x: 100, y: 50 });
    expect(Object.keys(gridLayout(estate(7, 1, false)).positions)).toHaveLength(7);
  });
});

describe('graph focus', () => {
  it('parses only bs:/svc: focus values', () => {
    expect(parseGraphFocus('bs:abc_1')).toEqual({ kind: 'bs', id: 'abc_1' });
    expect(parseGraphFocus('svc:x')).toEqual({ kind: 'svc', id: 'x' });
    expect(parseGraphFocus('team:x')).toBeNull();
    expect(parseGraphFocus('svc:../etc')).toBeNull();
    expect(parseGraphFocus(undefined)).toBeNull();
    expect(formatGraphFocus({ kind: 'bs', id: 'q' })).toBe('bs:q');
  });

  it('walks both directions up to the hop limit and stops at the node budget', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'b' },
      { from: 'c', to: 'd' },
    ];
    expect(nodesWithinHops(edges, ['a'], 2)).toEqual(new Set(['a', 'b', 'c']));
    expect(nodesWithinHops(edges, ['b'], 1)).toEqual(new Set(['a', 'b', 'c']));
    expect(nodesWithinHops(edges, ['a'], 3, 2).size).toBe(2);
  });
});
