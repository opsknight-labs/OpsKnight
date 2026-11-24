import { describe, expect, it } from 'vitest';
import {
  clampMoment,
  markSpof,
  overlayDiff,
  readViewConfig,
  snapshotView,
  TIME_TRAVEL_DAYS,
  type GraphDiff,
  type GraphSnapshot,
} from '@/components/service-graph/insights';
import { layoutEmbed } from '@/components/service-graph/embed-layout';
import { buildGraphModel, trafficStyle } from '@/components/service-graph/model';

const node = (id: string, status = 'OPERATIONAL') => ({
  id,
  name: id,
  teamId: null,
  teamName: null,
  openIncidents: 0,
  highestOpenUrgency: null,
  status,
  reasons: [],
});
const base = {
  nodes: [node('a'), node('b'), node('c')],
  edges: [
    {
      id: 'e1',
      upstreamServiceId: 'b',
      downstreamServiceId: 'a',
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
      dependencyType: 'SOFT',
      traffic: { requestRate: 5, errorRate: 0.2, windowStart: '2026-01-01T00:00:00Z' },
    },
  ],
  truncated: false,
  businessServices: [],
  memberEdges: [],
  supportEdges: [],
  focus: null,
} as never;

describe('snapshotView', () => {
  const snapshot = {
    truncated: false,
    services: [
      { id: 'a', name: 'a', teamId: null, status: 'MAJOR_OUTAGE', openIncidentCount: 2 },
      { id: 'b', name: 'b', teamId: null, status: 'OPERATIONAL', openIncidentCount: 0 },
    ],
    businessServices: [],
    dependencies: [
      { upstreamServiceId: 'b', downstreamServiceId: 'a', state: 'ACTIVE', origin: 'DECLARED', since: '' },
      { upstreamServiceId: 'c', downstreamServiceId: 'a', state: 'ACTIVE', origin: 'DECLARED', since: '' },
    ],
    members: [],
    supports: [],
  } as unknown as GraphSnapshot;

  it('drops services that did not exist, replays status and keeps live semantics only where the edge still exists', () => {
    const view = snapshotView(base, snapshot);
    expect(view.nodes.map(n => n.id)).toEqual(['a', 'b']);
    expect(view.nodes[0]).toMatchObject({ status: 'MAJOR_OUTAGE', openIncidents: 2 });
    // The edge to the not-yet-existing service c is dropped; the surviving one keeps its type, loses live traffic.
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]).toMatchObject({ id: 'e1', dependencyType: 'SOFT', traffic: null });
  });
});

describe('overlayDiff and markSpof', () => {
  const model = buildGraphModel(base);
  const diff = {
    addedDependencies: [{ upstreamServiceId: 'b', downstreamServiceId: 'a' }],
    newlySuggestedDependencies: [],
    removedDependencies: [
      { upstreamServiceId: 'c', downstreamServiceId: 'a', origin: 'DECLARED' },
      { upstreamServiceId: 'zz', downstreamServiceId: 'a', origin: 'DECLARED' },
    ],
  } as unknown as GraphDiff;

  it('marks added edges and draws removed ones only when both ends are on the graph', () => {
    const links = overlayDiff(model.items, model.links, diff);
    expect(links.find(l => l.dependencyId === 'e1')?.diff).toBe('added');
    const ghosts = links.filter(l => l.diff === 'removed');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ source: 'svc:a', target: 'svc:c', dependencyId: null });
    expect(model.links[0].diff).toBeUndefined();
  });

  it('badges only the listed technical services', () => {
    const items = markSpof(model.items, new Set(['b']));
    expect(items.filter(i => i.spof).map(i => i.id)).toEqual(['b']);
    expect(markSpof(model.items, new Set())).toBe(model.items);
  });
});

describe('small helpers', () => {
  it('clamps a moment into the last 90 days and never the future', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(clampMoment(new Date('2030-01-01'), now)).toEqual(now);
    expect(clampMoment(new Date('2020-01-01'), now).getTime()).toBe(now.getTime() - TIME_TRAVEL_DAYS * 864e5);
  });

  it('reads a stored view config defensively', () => {
    expect(readViewConfig({ focus: 'svc:1', hops: 3, search: 'q=x' })).toEqual({ focus: 'svc:1', hops: 3, search: 'q=x' });
    expect(readViewConfig(null)).toEqual({ focus: null, hops: null, search: '' });
    expect(readViewConfig({ focus: 5, search: {} })).toEqual({ focus: null, hops: null, search: '' });
  });

  it('weights edges by traffic and only when it exists', () => {
    expect(trafficStyle(null)).toBeNull();
    expect(trafficStyle({ requestRate: 0, errorRate: 0, windowStart: '' })).toMatchObject({ tone: 'ok' });
    expect(trafficStyle({ requestRate: 1000, errorRate: 0.02, windowStart: '' })).toMatchObject({ tone: 'warn' });
    expect(trafficStyle({ requestRate: 10, errorRate: 0.2, windowStart: '' })?.tone).toBe('bad');
    expect(trafficStyle({ requestRate: 1e9, errorRate: 0, windowStart: '' })?.width).toBeLessThanOrEqual(4);
  });
});

describe('layoutEmbed', () => {
  it('puts dependents left of what they depend on and survives a cycle', () => {
    const layout = layoutEmbed({
      truncated: false,
      services: [
        { ref: 'S1', status: 'OPERATIONAL' },
        { ref: 'S2', status: 'OPERATIONAL' },
      ],
      businessServices: [{ ref: 'B1', status: 'OPERATIONAL' }],
      dependencies: [{ from: 'S2', to: 'S1' }],
      members: [{ businessService: 'B1', service: 'S1' }],
    });
    const x = Object.fromEntries(layout.nodes.map(n => [n.ref, n.x]));
    expect(x.B1).toBeLessThan(x.S1);
    expect(x.S1).toBeLessThan(x.S2);
    expect(layout.edges).toContainEqual({ from: 'S1', to: 'S2', kind: 'dependency' });
    expect(() =>
      layoutEmbed({
        truncated: false,
        services: [{ ref: 'S1', status: 'X' }, { ref: 'S2', status: 'X' }],
        businessServices: [],
        dependencies: [{ from: 'S1', to: 'S2' }, { from: 'S2', to: 'S1' }],
        members: [],
      })
    ).not.toThrow();
  });
});
