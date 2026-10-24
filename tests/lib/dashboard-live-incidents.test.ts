import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  incident: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { getLiveIncidentFeed, liveIncidentFilterWhere } from '@/lib/dashboard/live-incidents';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const scopedActor = {
  id: 'user-a',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-a'],
} as unknown as AuthorizationActor;
const adminActor = { ...scopedActor, id: 'admin', role: 'ADMIN' } as AuthorizationActor;

const row = {
  id: 'inc-1',
  title: 'Sensitive automation title',
  automationSourceRestricted: true,
  automationDecision: null,
  automationTraces: [],
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'P1',
  createdAt: new Date('2026-10-24T10:00:00.000Z'),
  updatedAt: new Date('2026-10-24T10:01:00.000Z'),
  service: { id: 'svc-a', name: 'API' },
  team: null,
  assignee: { id: 'user-b', name: '', email: 'b@example.com' },
};

describe('getLiveIncidentFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.incident.findMany.mockResolvedValue([row]);
    prismaMock.incident.count.mockResolvedValue(1);
  });

  it('reads only OPEN + ACKNOWLEDGED, newest first, inside the authorization scope', async () => {
    await getLiveIncidentFeed(scopedActor, 'active');
    const args = prismaMock.incident.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.where.AND).toContainEqual({ status: { in: ['OPEN', 'ACKNOWLEDGED'] } });
    // Scoped readers always carry the incidentReadWhere OR clause; never a createdAt bound.
    expect(JSON.stringify(args.where)).toContain('"assigneeId":"user-a"');
    expect(JSON.stringify(args.where)).not.toContain('createdAt');
    expect(prismaMock.incident.count.mock.calls[0][0].where).toEqual(args.where);
  });

  it('applies no authorization narrowing for global readers', async () => {
    await getLiveIncidentFeed(adminActor, 'active');
    expect(prismaMock.incident.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
  });

  it('redacts restricted automation titles for non-sensitive readers and serializes dates', async () => {
    const feed = await getLiveIncidentFeed(scopedActor, 'active');
    expect(feed.total).toBe(1);
    expect(feed.incidents[0]).toMatchObject({
      id: 'inc-1',
      title: 'Restricted alert content',
      createdAt: '2026-10-24T10:00:00.000Z',
      assignee: { id: 'user-b', name: 'b@example.com' },
    });
  });

  it('clamps the requested limit', async () => {
    await getLiveIncidentFeed(adminActor, 'active', { limit: 10_000 });
    expect(prismaMock.incident.findMany.mock.calls[0][0].take).toBe(100);
  });

  it('builds filter predicates without widening scope', () => {
    expect(liveIncidentFilterWhere(scopedActor, 'active')).toEqual({});
    expect(liveIncidentFilterWhere(scopedActor, 'critical')).toEqual({
      OR: [{ urgency: 'HIGH' }, { priority: 'P1' }],
    });
    expect(liveIncidentFilterWhere(scopedActor, 'mine')).toEqual({ assigneeId: 'user-a' });
    expect(liveIncidentFilterWhere(scopedActor, 'my_teams')).toEqual({
      OR: [{ teamId: { in: ['team-a'] } }, { service: { teamId: { in: ['team-a'] } } }],
    });
    expect(
      liveIncidentFilterWhere({ ...scopedActor, teamIds: [] } as AuthorizationActor, 'my_teams')
    ).toEqual({ id: { in: [] } });
  });
});
