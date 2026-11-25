import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  systemConfig: { findUnique: vi.fn() },
  savedGraphView: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import {
  createView,
  getEmbeddedView,
  applyViewFilters,
  shareView,
  viewConfigSchema,
} from '@/lib/intelligence/dependencies/insights/views';

const actor = (role: string, caps?: string[]) =>
  ({
    id: 'u1',
    role,
    status: 'ACTIVE',
    teamIds: ['t1'],
    capabilities: caps ? new Set(caps) : undefined,
  }) as never;

beforeEach(() => vi.clearAllMocks());

describe('viewConfigSchema', () => {
  it('bounds pinned positions and hops, and rejects unknown keys', () => {
    const pinned = Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0 }));
    expect(viewConfigSchema.safeParse({ pinned }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ hops: 4 }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ focus: 'nonsense' }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(viewConfigSchema.parse({}).hops).toBe(2);
  });
});

describe('view permissions', () => {
  const input = { name: 'v', config: viewConfigSchema.parse({}) };
  it('lets nobody make a TEAM view for a team they are not in', async () => {
    await expect(createView(actor('USER'), { ...input, visibility: 'TEAM', teamId: 'other' })).rejects.toThrow();
    expect(db.savedGraphView.create).not.toHaveBeenCalled();
  });
  it('keeps ORG views for operations managers', async () => {
    await expect(createView(actor('USER'), { ...input, visibility: 'ORG' })).rejects.toThrow();
    expect(db.savedGraphView.create).not.toHaveBeenCalled();
  });
  it('makes embeds admin-only and off by default', async () => {
    await expect(shareView(actor('RESPONDER'), 'v1', 7)).rejects.toThrow();
    db.systemConfig.findUnique.mockResolvedValue(null);
    await expect(shareView(actor('ADMIN'), 'v1', 7)).rejects.toThrow();
    expect(db.savedGraphView.update).not.toHaveBeenCalled();
  });
});

describe('getEmbeddedView', () => {
  it('returns null for malformed tokens and while embeds are off, without a lookup', async () => {
    expect(await getEmbeddedView('nope')).toBeNull();
    db.systemConfig.findUnique.mockResolvedValue(null);
    expect(await getEmbeddedView(`gve_${'a'.repeat(43)}`)).toBeNull();
    expect(db.savedGraphView.findUnique).not.toHaveBeenCalled();
  });
  it('returns null for revoked and expired tokens', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: true });
    const token = `gve_${'a'.repeat(43)}`;
    db.savedGraphView.findUnique.mockResolvedValueOnce({ shareRevokedAt: new Date(), shareExpiresAt: new Date(Date.now() + 1e6) });
    expect(await getEmbeddedView(token)).toBeNull();
    db.savedGraphView.findUnique.mockResolvedValueOnce({ shareRevokedAt: null, shareExpiresAt: new Date(Date.now() - 1) });
    expect(await getEmbeddedView(token)).toBeNull();
  });
});

describe('applyViewFilters', () => {
  const graph = {
    nodes: [
      { id: 'a', status: 'OPERATIONAL', teamId: 't1' },
      { id: 'b', status: 'MAJOR_OUTAGE', teamId: 't2' },
      { id: 'c', status: 'OPERATIONAL', teamId: 't1' },
    ],
    businessServices: [{ id: 'x', status: 'OPERATIONAL', teamId: 't2' }],
    edges: [
      { upstreamServiceId: 'a', downstreamServiceId: 'b', status: 'ACTIVE', origin: 'DECLARED' },
      { upstreamServiceId: 'a', downstreamServiceId: 'c', status: 'ACTIVE', origin: 'OBSERVED' },
    ],
    memberEdges: [
      { serviceId: 'b', businessServiceId: 'x' },
      { serviceId: 'a', businessServiceId: 'x' },
    ],
  };
  it('drops filtered-out nodes and every edge touching them', () => {
    const out = applyViewFilters(graph, { teamIds: ['t1'] });
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'c']);
    expect(out.businessServices).toEqual([]);
    expect(out.edges).toHaveLength(1);
    expect(out.memberEdges).toEqual([]);
  });
  it('filters by status and origin', () => {
    expect(applyViewFilters(graph, { statuses: ['OPERATIONAL'] }).edges).toHaveLength(1);
    expect(applyViewFilters(graph, { origins: ['DECLARED'] }).edges).toHaveLength(1);
    expect(applyViewFilters(graph, {}).nodes).toHaveLength(3);
  });
});
