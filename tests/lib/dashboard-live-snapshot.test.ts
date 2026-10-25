import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  incident: { findMany: vi.fn(), count: vi.fn() },
  incidentEvent: { findMany: vi.fn() },
  onCallSchedule: { findMany: vi.fn() },
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
  currentEscalationStep: null,
  _count: { alerts: 2, watchers: 1 },
};

const trendRow = {
  createdAt: new Date(Date.now() - 30 * 60_000),
  acknowledgedAt: null,
  resolvedAt: null,
  urgency: 'HIGH',
  priority: 'P1',
  assigneeId: null,
  teamId: null,
  service: { teamId: 'team-a' },
};

/** Only the bulk feed projection selects `title`; trend reads do not. */
const isActiveSetRead = (args: { select?: { title?: boolean } }) => args.select?.title === true;
const activeSetCalls = () =>
  prismaMock.incident.findMany.mock.calls.filter(([args]) => isActiveSetRead(args));
const whereOf = (call: unknown[]) => JSON.stringify((call[0] as { where: unknown }).where);

describe('getLiveDashboardSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    prismaMock.incident.findMany.mockImplementation(async args =>
      isActiveSetRead(args) ? [dbRow] : [trendRow]
    );
    prismaMock.incidentEvent.findMany.mockResolvedValue([]);
    prismaMock.onCallSchedule.findMany.mockResolvedValue([
      { id: 's1', name: 'Primary' },
      { id: 's2', name: 'Secondary' },
    ]);
  });

  it('reads one bounded, newest-first active set inside the authorization scope', async () => {
    await getLiveDashboardSnapshot(scoped('user-a', ['team-a']), DEFAULT_LIVE_QUERY, {
      generation: '1',
    });
    // Two partitions: the team-shared window and this user's small personal set.
    const calls = activeSetCalls();
    expect(calls).toHaveLength(2);
    const shared = calls.find(call => whereOf(call).includes('"teamId"'))!;
    const personal = calls.find(call => whereOf(call).includes('"assigneeId":"user-a"'))!;
    for (const [args] of [shared, personal]) {
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(args.where.AND).toContainEqual({ status: { in: ['OPEN', 'ACKNOWLEDGED'] } });
      expect(JSON.stringify(args.where)).not.toContain('createdAt');
    }
    expect(shared[0].take).toBe(2001);
    expect(personal[0].take).toBe(501);
    expect(whereOf(shared)).not.toContain('user-a');
    expect(whereOf(shared)).toContain('"visibility":"PUBLIC"');
    expect(
      prismaMock.incidentEvent.findMany.mock.calls
        .map(call => JSON.stringify(call[0].where))
        .some(where => where.includes('"assigneeId":"user-a"'))
    ).toBe(true);
  });

  it('shares the team partition between users of the same teams; only personal reads are per user', async () => {
    await Promise.all([
      getLiveDashboardSnapshot(scoped('u1', ['team-a', 'team-b']), DEFAULT_LIVE_QUERY, {
        generation: '2',
      }),
      getLiveDashboardSnapshot(scoped('u2', ['team-b', 'team-a']), DEFAULT_LIVE_QUERY, {
        generation: '2',
      }),
      getLiveDashboardSnapshot(scoped('u3', ['team-c']), DEFAULT_LIVE_QUERY, { generation: '2' }),
    ]);
    const calls = activeSetCalls();
    const sharedReads = calls.filter(call => whereOf(call).includes('"visibility":"PUBLIC"'));
    const personalReads = calls.filter(call => !whereOf(call).includes('"visibility":"PUBLIC"'));
    // team-a+team-b once, team-c once; three personal reads.
    expect(sharedReads).toHaveLength(2);
    expect(personalReads).toHaveLength(3);
    // Different team sets never share rows.
    expect(sharedReads.map(call => whereOf(call).includes('team-c')).sort()).toEqual([false, true]);
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
    expect(activeSetCalls()).toHaveLength(1);
    // A newer generation inside the freshness window is served from the shared read ...
    const early = await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      generation: '6',
    });
    expect(activeSetCalls()).toHaveLength(1);
    // ... and the snapshot honestly reports the older generation it reflects.
    expect(early.generation).toBe('5');
    // Once the window passes, a viewer that knows of a newer generation triggers one re-read.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 1_000);
      const later = await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
        generation: '6',
      });
      expect(later.generation).toBe('6');
      expect(activeSetCalls()).toHaveLength(2);
      // A viewer that already knows only generation 6 is satisfied by that read.
      await getLiveDashboardSnapshot(admin('a2'), DEFAULT_LIVE_QUERY, { generation: '6' });
      vi.setSystemTime(Date.now() + 5_000);
      await getLiveDashboardSnapshot(admin('a2'), DEFAULT_LIVE_QUERY, { generation: '6' });
      expect(activeSetCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
    // Trends refresh on a fixed cadence, not on every realtime generation: one indexed read
    // each for created, acknowledged and resolved incidents, shared by every viewer.
    expect(
      prismaMock.incident.findMany.mock.calls.filter(([args]) => !isActiveSetRead(args))
    ).toHaveLength(3);
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
      team: { id: 'team-a', name: 'Alpha' },
      assignee: { id: 'u2', name: 'b@example.com' },
    });
    // Raw SLA inputs and inspector-only context never travel in the bulk feed.
    for (const key of [
      'slaPausedMs',
      'slaAckTargetMs',
      'acknowledgedAt',
      'dedupKey',
      'latestRunbook',
    ]) {
      expect(snapshot.incidents[0]).not.toHaveProperty(key);
    }
    expect(snapshot.incidents[0].sla).toBeDefined();
    expect(snapshot.summary.active).toBe(1);
    expect(snapshot.incidents[0]).toMatchObject({
      escalationLevel: null,
      alertCount: 2,
      responderCount: 1,
    });
    expect(snapshot.rail.onCall).toEqual([
      expect.objectContaining({
        id: 'shift-1',
        scheduleId: 's1',
        scheduleName: 'Primary',
        user: { id: 'u1', name: 'Ava', avatarUrl: null, gender: null },
      }),
    ]);
    expect(snapshot.coverage).toMatchObject({
      me: { onCall: true, schedules: ['Primary'] },
      gaps: [{ id: 's2', name: 'Secondary' }],
      scheduleCount: 2,
    });
    expect(snapshot.trend.createdLastHour).toBe(1);
    expect(snapshot.trend.createdCriticalLastHour).toBe(1);
    expect(snapshot.trend.created).toHaveLength(24);
    expect(snapshot.truncated).toBe(false);
  });

  it('clamps the requested row limit', async () => {
    prismaMock.incident.findMany.mockImplementation(async args =>
      isActiveSetRead(args)
        ? Array.from({ length: 150 }, (_, index) => ({ ...dbRow, id: `inc-${index}` }))
        : []
    );
    const snapshot = await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      limit: 10_000,
      generation: '11',
    });
    expect(snapshot.incidents).toHaveLength(100);
    expect(snapshot.total).toBe(150);
  });

  it('returns pinned incidents from the same authorized set without another query', async () => {
    const snapshot = await getLiveDashboardSnapshot(
      admin('a1'),
      { ...DEFAULT_LIVE_QUERY, view: 'mine' },
      { generation: '12', pinIds: ['inc-1', 'not-visible'] }
    );
    expect(snapshot.incidents).toHaveLength(0);
    expect(snapshot.pinned.map(item => item.id)).toEqual(['inc-1']);
    expect(activeSetCalls()).toHaveLength(1);
  });

  it('enforces schedule authorization scope and never leaks unauthorized schedules or shifts', async () => {
    const actor = scoped('u1', ['team-a']);
    await getLiveDashboardSnapshot(actor, DEFAULT_LIVE_QUERY, { generation: '20' });

    const scheduleCalls = prismaMock.onCallSchedule.findMany.mock.calls;
    expect(scheduleCalls.length).toBeGreaterThan(0);
    const lastScheduleCall = scheduleCalls[scheduleCalls.length - 1][0];
    expect(lastScheduleCall).toHaveProperty('where');
    expect(JSON.stringify(lastScheduleCall.where)).toContain('u1');
  });

  it('restricts schedule and on-call data for users without matching schedules', async () => {
    prismaMock.onCallSchedule.findMany.mockImplementation(async _args => {
      // If scoped where clause is present for u-no-schedules, return empty
      return [];
    });
    const { getActiveOnCallShifts } = await import('@/lib/oncall-shifts');
    vi.mocked(getActiveOnCallShifts).mockResolvedValueOnce([]);

    const snapshot = await getLiveDashboardSnapshot(
      scoped('u-no-schedules', []),
      DEFAULT_LIVE_QUERY,
      { generation: '21' }
    );

    expect(snapshot.coverage.scheduleCount).toBe(0);
    expect(snapshot.coverage.gaps).toEqual([]);
    expect(snapshot.rail.onCall).toEqual([]);
  });

  it('keeps counters exact and surfaces older critical work when the window is truncated', async () => {
    const many = Array.from({ length: 2_001 }, (_, index) => ({
      ...dbRow,
      id: `new-${index}`,
      urgency: 'LOW',
      priority: 'P4',
      assignee: { id: 'u9', name: 'N', email: 'n@example.com' },
      createdAt: new Date(Date.UTC(2026, 9, 24, 10, 0, 0) - index * 1_000),
    }));
    const oldCritical = {
      ...dbRow,
      id: 'old-critical',
      automationSourceRestricted: false,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      assignee: null,
    };
    prismaMock.incident.findMany.mockImplementation(async args => {
      if (!isActiveSetRead(args)) return [];
      return JSON.stringify(args.where).includes('"createdAt"') ? [oldCritical] : many;
    });
    prismaMock.incident.count.mockImplementation(async ({ where }: { where: unknown }) => {
      const json = JSON.stringify(where);
      if (json.includes('"status":"OPEN"')) return 9_000;
      if (json.includes('"priority":"P1"') && json.includes('"assigneeId":null')) return 41;
      if (json.includes('"priority":"P1"')) return 300;
      if (json.includes('"assigneeId":null')) return 700;
      return 12_345;
    });
    const snapshot = await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      generation: '20',
    });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.countsExact).toBe(true);
    expect(snapshot.summary).toMatchObject({
      active: 12_345,
      triggered: 9_000,
      acknowledged: 3_345,
      critical: 300,
      unassigned: 700,
      unassignedCritical: 41,
    });
    expect(snapshot.total).toBe(12_345);
    expect(snapshot.workingSet).toBe(2_001);
    // The older critical, unowned incident is still reachable beyond the newest-2000 window.
    expect(snapshot.pinned).toEqual([]);
    const critical = await getLiveDashboardSnapshot(
      admin('a1'),
      { ...DEFAULT_LIVE_QUERY, view: 'critical' },
      { generation: '20' }
    );
    expect(critical.incidents.map(item => item.id)).toContain('old-critical');
    // A narrower scope cannot reuse database totals, so it reports approximate counters.
    const mine = await getLiveDashboardSnapshot(
      admin('a1'),
      { ...DEFAULT_LIVE_QUERY, scope: 'mine' },
      { generation: '20' }
    );
    expect(mine.countsExact).toBe(false);
  });
});
