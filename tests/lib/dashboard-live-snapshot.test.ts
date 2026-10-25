import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  incident: { findMany: vi.fn() },
  incidentEvent: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/oncall-shifts', () => ({
  getActiveOnCallShifts: vi.fn().mockResolvedValue([
    {
      id: 'shift-1',
      userId: 'u1',
      user: { id: 'u1', name: 'Ava', avatarUrl: null, gender: null },
      scheduleId: 's1',
      schedule: { id: 's1', name: 'Primary' },
      start: new Date(),
      end: new Date(),
    },
  ]),
}));

import { getLiveDashboardSnapshot, resolveLiveScope } from '@/lib/dashboard/live-incidents';
import { DEFAULT_LIVE_QUERY } from '@/lib/dashboard/live-incidents-shared';
import { clearCache } from '@/lib/realtime-cache';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const admin = (id: string) =>
  ({ id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] }) as unknown as AuthorizationActor;
const scoped = (id: string, teamIds: string[]) =>
  ({ id, role: 'USER', status: 'ACTIVE', teamIds }) as unknown as AuthorizationActor;

const dbRow = {
  id: 'inc-1',
  title: 'Sensitive automation title',
  automationSourceRestricted: true,
  automationDecision: null,
  automationTraces: [],
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'P1',
  escalationStatus: null,
  createdAt: new Date('2026-10-24T10:00:00.000Z'),
  updatedAt: new Date('2026-10-24T10:01:00.000Z'),
  acknowledgedAt: null,
  slaFirstAcknowledgedAt: null,
  slaAckTargetMs: null,
  slaResolveTargetMs: null,
  slaTargetSource: null,
  slaTargetCapturedAt: null,
  slaPausedMs: BigInt(0),
  slaPauseStartedAt: null,
  slaAckElapsedMs: null,
  slaResolveElapsedMs: null,
  service: { id: 'svc', name: 'API', teamId: 'team-a', team: { id: 'team-a', name: 'Alpha' } },
  team: null,
  assignee: { id: 'u2', name: '', email: 'b@example.com' },
};

describe('getLiveDashboardSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    prismaMock.incident.findMany.mockResolvedValue([dbRow]);
    prismaMock.incidentEvent.findMany.mockResolvedValue([]);
  });

  it('reads one bounded, newest-first active set inside the authorization scope', async () => {
    await getLiveDashboardSnapshot(scoped('user-a', ['team-a']), DEFAULT_LIVE_QUERY, {
      generation: '1',
    });
    const args = prismaMock.incident.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(2001);
    expect(args.where.AND).toContainEqual({ status: { in: ['OPEN', 'ACKNOWLEDGED'] } });
    expect(JSON.stringify(args.where)).toContain('"assigneeId":"user-a"');
    expect(JSON.stringify(args.where)).not.toContain('createdAt');
    expect(JSON.stringify(prismaMock.incidentEvent.findMany.mock.calls[0][0].where)).toContain(
      '"assigneeId":"user-a"'
    );
  });

  it('shares one query across viewers with the same scope and generation', async () => {
    await Promise.all([
      getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, { generation: '5' }),
      getLiveDashboardSnapshot(
        admin('a2'),
        { ...DEFAULT_LIVE_QUERY, view: 'critical' },
        {
          generation: '5',
        }
      ),
      getLiveDashboardSnapshot(
        admin('a3'),
        { ...DEFAULT_LIVE_QUERY, search: 'api' },
        {
          generation: '5',
        }
      ),
    ]);
    expect(prismaMock.incident.findMany).toHaveBeenCalledTimes(1);
    await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, { generation: '6' });
    expect(prismaMock.incident.findMany).toHaveBeenCalledTimes(2);
  });

  it('never shares a scoped set between different users or team sets', () => {
    expect(resolveLiveScope(admin('a1')).key).toBe(resolveLiveScope(admin('a2')).key);
    expect(resolveLiveScope(scoped('u1', ['t1'])).key).not.toBe(
      resolveLiveScope(scoped('u2', ['t1'])).key
    );
    expect(resolveLiveScope(scoped('u1', ['t1', 't2'])).key).toBe(
      resolveLiveScope(scoped('u1', ['t2', 't1'])).key
    );
    expect(resolveLiveScope(scoped('u1', ['t1'])).key).not.toBe(
      resolveLiveScope(scoped('u1', ['t1', 't2'])).key
    );
  });

  it('redacts restricted titles, serializes values and returns rail data', async () => {
    const snapshot = await getLiveDashboardSnapshot(scoped('u1', ['team-a']), DEFAULT_LIVE_QUERY, {
      generation: '9',
    });
    expect(snapshot.incidents[0]).toMatchObject({
      title: 'Restricted alert content',
      createdAt: '2026-10-24T10:00:00.000Z',
      slaPausedMs: 0,
      team: { id: 'team-a', name: 'Alpha' },
      assignee: { id: 'u2', name: 'b@example.com' },
    });
    expect(snapshot.summary.active).toBe(1);
    expect(snapshot.rail.onCall).toEqual([
      {
        id: 'shift-1',
        scheduleName: 'Primary',
        user: { id: 'u1', name: 'Ava', avatarUrl: null, gender: null },
      },
    ]);
    expect(snapshot.truncated).toBe(false);
  });

  it('clamps the requested row limit', async () => {
    prismaMock.incident.findMany.mockResolvedValue(
      Array.from({ length: 150 }, (_, index) => ({ ...dbRow, id: `inc-${index}` }))
    );
    const snapshot = await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      limit: 10_000,
      generation: '11',
    });
    expect(snapshot.incidents).toHaveLength(100);
    expect(snapshot.total).toBe(150);
  });
});
