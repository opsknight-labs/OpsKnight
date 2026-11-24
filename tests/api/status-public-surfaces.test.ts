import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const route = vi.hoisted(() => ({ snapshot: null as unknown }));
vi.mock('@/lib/status-pages/snapshot', () => ({
  getStatusPageSnapshotByRoute: vi.fn(async () => ({ snapshot: route.snapshot })),
}));

import { GET as groupGet } from '@/app/api/status/[slug]/groups/[id]/route';
import {
  findPublicIncident,
  getOpenStatusSnapshot,
  groupScope,
  incidentsForMonth,
  shiftMonth,
} from '@/lib/status-pages/public-access';

const make = (page: Record<string, unknown> = {}) => ({
  revision: 'r1',
  generatedAt: '2026-11-25T00:00:00Z',
  page: { id: 'p1', name: 'Acme', enabled: true, ...page },
  services: [
    {
      id: 's1',
      name: 'API',
      status: 'OPERATIONAL',
      activeIncidentCount: 0,
      team: { id: 't', name: 'secret' },
    },
    { id: 's2', name: 'Web', status: 'DEGRADED', activeIncidentCount: 1 },
  ],
  businessServices: [
    {
      id: 'g1',
      name: 'Platform',
      status: 'DEGRADED',
      memberServiceIds: ['s1'],
      childIds: ['g2'],
      activeIncidentCount: 0,
      impactedServiceCount: 0,
    },
    {
      id: 'g2',
      name: 'Edge',
      status: 'DEGRADED',
      parentId: 'g1',
      memberServiceIds: ['s2'],
      activeIncidentCount: 1,
      impactedServiceCount: 1,
    },
  ],
  incidents: [
    {
      id: 'i1',
      status: 'OPEN',
      title: 'Edge down',
      service: { id: 's2' },
      createdAt: '2026-11-03T10:00:00Z',
    },
    { id: 'i0', status: 'RESOLVED', title: 'Old', createdAt: '2026-10-03T10:00:00Z' },
  ],
});
const call = (slug = 'acme', id = 'g1', headers: Record<string, string> = {}) =>
  groupGet(new NextRequest(`http://x/api/status/${slug}/groups/${id}`, { headers }), {
    params: Promise.resolve({ slug, id }),
  });

beforeEach(() => {
  route.snapshot = make();
});

describe('group endpoint', () => {
  it('returns members, children incidents, cache headers and no team data', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=30');
    const body = await res.json();
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(['s1']);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body.incidents.map((i: { id: string }) => i.id)).toEqual(['i1']);
  });
  it('answers 304 for a matching ETag', async () => {
    const etag = (await call()).headers.get('etag')!;
    expect((await call('acme', 'g1', { 'if-none-match': etag })).status).toBe(304);
  });
  it.each([
    ['private', { requireAuth: true }],
    ['token gated', { statusApiRequireToken: true }],
    ['disabled', { enabled: false }],
  ])('404s for %s pages', async (_name, page) => {
    route.snapshot = make(page);
    expect((await call()).status).toBe(404);
    expect(await getOpenStatusSnapshot('acme')).toBeNull();
  });
  it('404s for unknown group or bad slug', async () => {
    expect((await call('acme', 'nope')).status).toBe(404);
    expect((await call('Bad Slug!')).status).toBe(404);
  });
});

describe('public access helpers', () => {
  it('scopes a group to nested members, cycle-safe', () => {
    const s = make() as never;
    expect([...groupScope(s, 'g1')!.memberIds].sort()).toEqual(['s1', 's2']);
    const cyc = make();
    cyc.businessServices[0].parentId = 'g2';
    expect(groupScope(cyc as never, 'g1')!.scope).toHaveLength(2);
  });
  it('finds incidents and pages months', () => {
    const s = make() as never;
    expect(findPublicIncident(s, 'i1')?.title).toBe('Edge down');
    expect(incidentsForMonth((s as { incidents: never[] }).incidents, '2026-11')).toHaveLength(1);
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});
