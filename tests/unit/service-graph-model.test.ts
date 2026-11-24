import { describe, expect, it } from 'vitest';
import type { ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';
import {
  applyStatuses,
  detailLevel,
  edgeImpactStatus,
  exportGraphJson,
  exportGraphSvg,
  filterGraph,
  findPath,
  impactSubgraph,
  matchItems,
  sortItems,
  mergeViews,
  traverse,
  type GraphItem,
  type GraphLink,
} from '@/components/service-graph/model';

const item = (id: string, over: Partial<GraphItem> = {}): GraphItem => ({
  key: id,
  kind: id.startsWith('bs:') ? 'bs' : 'svc',
  id: id.slice(id.indexOf(':') + 1),
  name: id,
  teamId: null,
  teamName: null,
  status: 'OPERATIONAL',
  openIncidents: 0,
  reasons: [],
  criticality: null,
  memberCount: null,
  ...over,
});
// source depends on target
const link = (source: string, target: string, over: Partial<GraphLink> = {}): GraphLink => ({
  key: `${source}>${target}`,
  source,
  target,
  kind: 'dependency',
  suggested: false,
  dependencyId: `${source}>${target}`,
  confidence: 1,
  origin: 'DECLARED',
  ...over,
});

// bs:shop -member-> svc:web -> svc:api -> svc:db ; svc:batch -> svc:db ; svc:db -> svc:api (cycle)
const links = [
  link('bs:shop', 'svc:web', { kind: 'member', dependencyId: null }),
  link('svc:web', 'svc:api'),
  link('svc:api', 'svc:db'),
  link('svc:batch', 'svc:db', { origin: 'OBSERVED' }),
  link('svc:db', 'svc:api'),
];
const items = ['bs:shop', 'svc:web', 'svc:api', 'svc:db', 'svc:batch', 'svc:lonely'].map(key =>
  item(key)
);

describe('impactSubgraph', () => {
  it('blast radius walks to everything that depends on the node, transitively', () => {
    const blast = impactSubgraph(links, 'svc:db', 'blast');
    expect([...blast.keys].sort()).toEqual(
      ['bs:shop', 'svc:api', 'svc:batch', 'svc:db', 'svc:web'].sort()
    );
    expect(blast.depth.get('svc:web')).toBe(2);
    expect(blast.linkKeys.has('svc:batch>svc:db')).toBe(true);
  });
  it('root-cause path walks to everything the node depends on and survives the cycle', () => {
    const root = impactSubgraph(links, 'svc:web', 'root');
    expect([...root.keys].sort()).toEqual(['svc:api', 'svc:db', 'svc:web']);
    expect(root.linkKeys.has('svc:db>svc:api')).toBe(true);
  });
  it('honours a depth limit and an isolated node', () => {
    expect([...impactSubgraph(links, 'svc:web', 'root', 1).keys].sort()).toEqual([
      'svc:api',
      'svc:web',
    ]);
    expect(impactSubgraph(links, 'svc:lonely', 'blast').keys).toEqual(new Set(['svc:lonely']));
  });
});

describe('findPath', () => {
  it('follows the dependency direction, either way round', () => {
    expect(findPath(links, 'svc:web', 'svc:db')?.keys).toEqual(['svc:web', 'svc:api', 'svc:db']);
    // from -> to order is kept whichever way the dependency runs
    expect(findPath(links, 'svc:db', 'svc:web')?.keys).toEqual(['svc:db', 'svc:api', 'svc:web']);
  });
  it('falls back to ignoring direction and returns null when unconnected', () => {
    expect(findPath(links, 'svc:batch', 'svc:web')?.keys).toEqual([
      'svc:batch',
      'svc:db',
      'svc:api',
      'svc:web',
    ]);
    expect(findPath(links, 'svc:web', 'svc:lonely')).toBeNull();
    expect(findPath(links, 'svc:web', 'svc:web')).toEqual({ keys: ['svc:web'], linkKeys: [] });
  });
});

describe('matchItems and filterGraph', () => {
  const model = {
    items: [
      item('svc:web', { name: 'Web', teamName: 'Storefront', teamId: 't1' }),
      item('svc:db', { name: 'Orders DB', status: 'MAJOR_OUTAGE', teamId: 't2' }),
      item('bs:shop', { name: 'Shop', criticality: 'TIER_0' }),
      item('bs:blog', { name: 'Blog', criticality: 'TIER_3' }),
    ],
    links: [link('svc:web', 'svc:db'), link('bs:shop', 'svc:web', { kind: 'member' })],
  };
  it('matches by name or team, blank matches nothing', () => {
    expect(matchItems(model.items, 'store')).toEqual(['svc:web']);
    expect(matchItems(model.items, 'DB')).toEqual(['svc:db']);
    expect(matchItems(model.items, '  ')).toEqual([]);
  });
  it('filters by tier, status and link origin', () => {
    expect(
      filterGraph(model, {
        query: '',
        teamId: '',
        impactedOnly: false,
        tiers: ['TIER_0'],
      }).items.map(i => i.key)
    ).toEqual(['svc:web', 'svc:db', 'bs:shop']);
    expect(
      filterGraph(model, {
        query: '',
        teamId: '',
        impactedOnly: false,
        statuses: ['MAJOR_OUTAGE'],
      }).items.map(i => i.key)
    ).toEqual(['svc:db']);
    expect(
      filterGraph(model, {
        query: '',
        teamId: '',
        impactedOnly: false,
        origin: 'OBSERVED',
      }).links.map(l => l.key)
    ).toEqual(['bs:shop>svc:web']);
  });
});

describe('edgeImpactStatus and applyStatuses', () => {
  const byKey = new Map([
    ['svc:db', item('svc:db', { status: 'PARTIAL_OUTAGE' })],
    ['svc:api', item('svc:api')],
  ]);
  it('colours an edge by its impacted dependency only', () => {
    expect(edgeImpactStatus(link('svc:api', 'svc:db'), byKey)).toBe('PARTIAL_OUTAGE');
    expect(edgeImpactStatus(link('svc:db', 'svc:api'), byKey)).toBeNull();
  });
  it('merges statuses and keeps identity when nothing changed', () => {
    const base = [item('svc:db'), item('bs:shop')];
    const same = applyStatuses(base, {
      services: { db: { status: 'OPERATIONAL', openIncidents: 0, reasons: [] } },
      businessServices: {},
    });
    expect(same).toBe(base);
    const next = applyStatuses(base, {
      services: { db: { status: 'MAJOR_OUTAGE', openIncidents: 2, reasons: [] } },
      businessServices: {},
    });
    expect(next[0]).toMatchObject({ status: 'MAJOR_OUTAGE', openIncidents: 2 });
    expect(next[1]).toBe(base[1]);
  });
});

describe('mergeViews', () => {
  const view = (ids: string[], boundary: string[]): ServiceGraphView => ({
    nodes: ids.map(id => ({
      id,
      name: id,
      teamId: null,
      teamName: null,
      openIncidents: 0,
      highestOpenUrgency: null,
      status: 'OPERATIONAL' as const,
    })),
    edges: [],
    truncated: false,
    businessServices: [],
    memberEdges: [],
    supportEdges: [],
    focus: null,
    boundaryIds: boundary,
  });
  it('unions nodes and moves the boundary outwards', () => {
    const merged = mergeViews(view(['a', 'b'], ['b']), view(['b', 'c'], ['c']), 'b');
    expect(merged.nodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(merged.boundaryIds).toEqual(['c']);
  });
});

describe('traverse and detailLevel', () => {
  it('moves along dependencies and dependents', () => {
    expect(traverse(links, items, 'svc:web', 'dependency')).toBe('svc:api');
    expect(traverse(links, items, 'svc:api', 'dependent')).toBe('svc:db');
    expect(traverse(links, items, 'svc:lonely', 'dependency')).toBeNull();
  });
  it('cycles through siblings that share a dependent', () => {
    const fan = [link('svc:x', 'svc:a'), link('svc:x', 'svc:b'), link('svc:x', 'svc:c')];
    const all = ['svc:a', 'svc:b', 'svc:c', 'svc:x'].map(key => item(key));
    expect(traverse(fan, all, 'svc:a', 'next')).toBe('svc:b');
    expect(traverse(fan, all, 'svc:c', 'next')).toBe('svc:a');
    expect(traverse(fan, all, 'svc:a', 'previous')).toBe('svc:c');
  });
  it('picks a detail level from the zoom', () => {
    expect(detailLevel(0.1)).toBe('dot');
    expect(detailLevel(0.5)).toBe('name');
    expect(detailLevel(1)).toBe('full');
  });
});

describe('exportGraphJson', () => {
  it('lists items and links', () => {
    const parsed = JSON.parse(exportGraphJson({ items, links }));
    expect(parsed.items).toHaveLength(6);
    expect(parsed.links[0]).toMatchObject({ from: 'bs:shop', to: 'svc:web', kind: 'member' });
  });
});

describe('exportGraphSvg', () => {
  it('draws placed nodes and escapes names', () => {
    const svg = exportGraphSvg(
      [item('svc:a', { name: '<b>&"' }), item('svc:b')],
      [link('svc:a', 'svc:b', { dependencyType: 'SOFT' })],
      { 'svc:a': { x: 0, y: 0 }, 'svc:b': { x: 300, y: 0 } },
      () => ({ width: 200, height: 60 })
    );
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&#60;b&#62;&#38;&#34;');
    expect(svg).toContain('stroke-dasharray="10 3 2 3"');
    expect(svg).toContain('marker-end');
  });
  it('skips nodes without a position and links to them', () => {
    const svg = exportGraphSvg([item('svc:a')], [link('svc:a', 'svc:z')], {}, () => ({
      width: 1,
      height: 1,
    }));
    expect(svg).not.toContain('<line');
  });
});

describe('sortItems', () => {
  const rows = [
    item('svc:b', { name: 'Beta', status: 'DEGRADED', openIncidents: 1 }),
    item('svc:a', { name: 'alpha', status: 'MAJOR_OUTAGE', openIncidents: 3 }),
    item('svc:c', { name: 'Gamma' }),
  ];
  it('sorts by name case-insensitively and does not mutate', () => {
    expect(sortItems(rows, [], 'name', 'asc').map(r => r.name)).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(rows[0].name).toBe('Beta');
  });
  it('sorts by severity and counts, descending, ties by name', () => {
    expect(sortItems(rows, [], 'status', 'desc').map(r => r.name)).toEqual([
      'alpha',
      'Beta',
      'Gamma',
    ]);
    expect(sortItems(rows, [], 'incidents', 'asc').map(r => r.name)).toEqual([
      'Gamma',
      'Beta',
      'alpha',
    ]);
    const l = [link('svc:c', 'svc:a'), link('svc:b', 'svc:a')];
    expect(sortItems(rows, l, 'usedBy', 'desc')[0].name).toBe('alpha');
  });
});
