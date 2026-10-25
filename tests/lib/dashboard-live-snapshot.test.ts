import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  incident: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  alert: { groupBy: vi.fn(), count: vi.fn() },
  incidentWatcher: { groupBy: vi.fn(), count: vi.fn() },
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

import {
  decodeLiveCursor,
  getLiveIncidentDetail,
  encodeLiveCursor,
  getLiveDashboardSnapshot,
  getLiveIncidentPage,
  liveQueryWhere,
  resolveLiveDashboardSnapshot,
  resolveLiveScope,
} from '@/lib/dashboard/live-incidents';
import { DEFAULT_LIVE_QUERY } from '@/lib/dashboard/live-incidents-shared';
import { clearCache } from '@/lib/realtime-cache';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
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
    prismaMock.alert.groupBy.mockImplementation(
      async ({ where }: { where: { incidentId: { in: string[] } } }) =>
        where.incidentId.in.map(incidentId => ({ incidentId, _count: { _all: 2 } }))
    );
    prismaMock.incidentWatcher.groupBy.mockImplementation(
      async ({ where }: { where: { incidentId: { in: string[] } } }) =>
        where.incidentId.in.map(incidentId => ({ incidentId, _count: { _all: 1 } }))
    );
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
    expect(snapshot.accuracy).toEqual({
      counters: 'exact',
      filtered: 'exact',
      sla: 'window',
      trend: 'exact',
    });
    expect(snapshot.summary.visibleActive).toBe(12_345);
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
    // Global alerts come from the whole visible set, not from the current filters.
    expect(critical.alerts.map(item => item.id)).toContain('old-critical');
    // A plain critical view maps to one exact counter; any extra filter falls back to the window.
    expect(critical.accuracy.filtered).toBe('exact');
    const filtered = await getLiveDashboardSnapshot(
      admin('a1'),
      { ...DEFAULT_LIVE_QUERY, view: 'critical', urgency: 'HIGH' },
      { generation: '20' }
    );
    expect(filtered.accuracy.filtered).toBe('window');
    expect(filtered.accuracy.counters).toBe('exact');
    const mine = await getLiveDashboardSnapshot(
      admin('a1'),
      { ...DEFAULT_LIVE_QUERY, scope: 'mine' },
      { generation: '20' }
    );
    // Counters for another scope are exact too (read for that slice), but a derived total is not.
    expect(mine.accuracy.counters).toBe('exact');
    expect(mine.accuracy.sla).toBe('window');
  });

  it('proves an unchanged projection before deriving it, and never across users or data changes', async () => {
    const first = await resolveLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      generation: '30',
    });
    expect(first.snapshot).not.toBeNull();
    const again = await resolveLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      generation: '31',
      ifNoneMatch: first.etag,
    });
    expect(again.snapshot).toBeNull();
    expect(again.etag).toBe(first.etag);

    // Another viewer, another query, another page size or other pins never validate.
    for (const [actor, query, extra] of [
      [admin('a2'), DEFAULT_LIVE_QUERY, {}],
      [admin('a1'), { ...DEFAULT_LIVE_QUERY, view: 'critical' as const }, {}],
      [admin('a1'), DEFAULT_LIVE_QUERY, { limit: 10 }],
      [admin('a1'), DEFAULT_LIVE_QUERY, { pinIds: ['inc-1'] }],
    ] as const) {
      const other = await resolveLiveDashboardSnapshot(actor, query, {
        generation: '31',
        ifNoneMatch: first.etag,
        ...extra,
      });
      expect(other.snapshot).not.toBeNull();
      expect(other.etag).not.toBe(first.etag);
    }

    // A change in the data changes the validator (here: a new incident after the window).
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 1_000);
      prismaMock.incident.findMany.mockImplementation(async args =>
        isActiveSetRead(args) ? [dbRow, { ...dbRow, id: 'inc-2' }] : [trendRow]
      );
      const changed = await resolveLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
        generation: '32',
        ifNoneMatch: first.etag,
      });
      expect(changed.snapshot).not.toBeNull();
      expect(changed.etag).not.toBe(first.etag);
      // Time-driven SLA signals invalidate the validator once the bucket advances.
      const stable = await resolveLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
        generation: '32',
      });
      vi.setSystemTime(Date.now() + 6_000);
      const later = await resolveLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
        generation: '32',
        ifNoneMatch: stable.etag,
      });
      expect(later.snapshot).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps alert and watcher counts out of the bulk read and reads them for the same ids', async () => {
    const snapshot = await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, {
      generation: '40',
    });
    expect(snapshot.incidents[0]).toMatchObject({ alertCount: 2, responderCount: 1 });
    const select = activeSetCalls()[0][0].select;
    expect(select).not.toHaveProperty('_count');
    expect(prismaMock.alert.groupBy.mock.calls[0][0].where.incidentId.in).toEqual(['inc-1']);
  });

  describe('keyset page beyond the working set', () => {
    const rows = (count: number, start = 0) =>
      Array.from({ length: count }, (_, index) => ({
        ...dbRow,
        id: `page-${start + index}`,
        automationSourceRestricted: false,
        createdAt: new Date(Date.UTC(2026, 8, 1) - (start + index) * 1_000),
      }));

    it('stays inside the authorization scope and continues from a position-only cursor', async () => {
      prismaMock.incident.findMany.mockResolvedValueOnce(rows(26));
      const first = await getLiveIncidentPage(
        scoped('user-a', ['team-a']),
        { ...DEFAULT_LIVE_QUERY, view: 'critical' },
        { limit: 25 }
      );
      expect(first.incidents).toHaveLength(25);
      expect(first.nextCursor).not.toBeNull();
      const firstArgs = prismaMock.incident.findMany.mock.calls.at(-1)![0];
      expect(firstArgs.take).toBe(26);
      expect(firstArgs.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      // The viewer's own read scope is always part of the predicate.
      expect(JSON.stringify(firstArgs.where)).toContain('"assigneeId":"user-a"');
      expect(JSON.stringify(firstArgs.where)).toContain('"visibility":"PUBLIC"');

      prismaMock.incident.findMany.mockResolvedValueOnce(rows(3, 25));
      const second = await getLiveIncidentPage(
        scoped('user-a', ['team-a']),
        { ...DEFAULT_LIVE_QUERY, view: 'critical' },
        { limit: 25, cursor: first.nextCursor }
      );
      expect(second.nextCursor).toBeNull();
      const secondWhere = JSON.stringify(prismaMock.incident.findMany.mock.calls.at(-1)![0].where);
      expect(secondWhere).toContain('"id":{"lt":"page-24"}');
      expect(secondWhere).toContain('"visibility":"PUBLIC"');
    });

    it('rejects forged cursors and views that cannot be paged from the database', async () => {
      expect(decodeLiveCursor('garbage')).toBeNull();
      expect(decodeLiveCursor(Buffer.from('{"a":1}').toString('base64url'))).toBeNull();
      expect(
        decodeLiveCursor(encodeLiveCursor({ createdAt: '2026-10-24T10:00:00.000Z', id: 'x' }))
      ).toMatchObject({
        id: 'x',
      });
      await expect(
        getLiveIncidentPage(admin('a1'), DEFAULT_LIVE_QUERY, { cursor: 'garbage' })
      ).rejects.toThrow('Invalid cursor');
      await expect(
        getLiveIncidentPage(admin('a1'), { ...DEFAULT_LIVE_QUERY, view: 'breaching' })
      ).rejects.toThrow('cannot be paged');
    });

    it('never lets a restricted viewer match redacted titles through search', () => {
      const query = { ...DEFAULT_LIVE_QUERY, search: 'customer-123' };
      const restricted = JSON.stringify(liveQueryWhere(scoped('u', ['t']), query, false));
      expect(restricted).toContain('"automationSourceRestricted":false');
      expect(restricted).toContain('"automationDecision":null');
      expect(restricted).toContain('"automationTraces":{"none":{}}');
      const privileged = JSON.stringify(liveQueryWhere(admin('a'), query, true));
      expect(privileged).not.toContain('automationSourceRestricted');
    });

    it('maps views, scope and facets to the same predicate the in-memory feed applies', () => {
      const where = (partial: Partial<typeof DEFAULT_LIVE_QUERY>, actor = scoped('me', ['t1'])) =>
        JSON.stringify(liveQueryWhere(actor, { ...DEFAULT_LIVE_QUERY, ...partial }, false));
      expect(where({ view: 'unassigned' })).toContain('"assigneeId":null');
      expect(where({ view: 'critical' })).toContain('"priority":"P1"');
      expect(where({ view: 'mine' })).toContain('"assigneeId":"me"');
      expect(where({ view: 'my_teams' })).toContain('"teamId":{"in":["t1"]}');
      expect(where({ view: 'my_teams' }, scoped('me', []))).toContain('"id":{"in":[]}');
      expect(where({ scope: 'mine' })).toContain('"assigneeId":"me"');
      const facets = where({ status: 'OPEN', urgency: 'HIGH', serviceId: 's1' });
      for (const fragment of ['"status":"OPEN"', '"urgency":"HIGH"', '"serviceId":"s1"']) {
        expect(facets).toContain(fragment);
      }
    });
  });

  describe('authorization isolation of cached data', () => {
    it('keys every partition by the full scope: team set, sensitivity and (for personal rows) the user', () => {
      const a = resolveLiveScope(scoped('u1', ['t1', 't2']));
      const b = resolveLiveScope(scoped('u2', ['t2', 't1']));
      const other = resolveLiveScope(scoped('u3', ['t1']));
      // Same team set shares the team-visible partition; personal partitions never match.
      expect(a.partitions[0].key).toBe(b.partitions[0].key);
      expect(a.partitions[1].key).not.toBe(b.partitions[1].key);
      expect(a.partitions[0].key).not.toBe(other.partitions[0].key);
      expect(a.partitions[1].key).toContain('u1');
      expect(a.partitions[0].key).not.toContain('u1');
      // Elevation or demotion selects different keys immediately.
      const global = resolveLiveScope(admin('a1'));
      expect(global.partitions).toHaveLength(1);
      expect(global.partitions[0].key).not.toBe(a.partitions[0].key);
      // Sensitivity is part of every key, so redacted and unredacted rows never mix.
      const restrictedAuditor = resolveLiveScope({
        id: 'x',
        role: 'AUDITOR',
        status: 'ACTIVE',
        teamIds: [],
      } as unknown as AuthorizationActor);
      expect(restrictedAuditor.key).not.toBe(global.key);
    });

    it('re-reads the team partition when team membership changes instead of serving the old set', async () => {
      await getLiveDashboardSnapshot(scoped('u1', ['team-a']), DEFAULT_LIVE_QUERY, {
        generation: '60',
      });
      const before = activeSetCalls().length;
      await getLiveDashboardSnapshot(scoped('u1', ['team-a', 'team-b']), DEFAULT_LIVE_QUERY, {
        generation: '60',
      });
      const added = activeSetCalls().slice(before);
      expect(added.some(call => whereOf(call).includes('team-b'))).toBe(true);
      expect(
        added.some(call => whereOf(call).includes('team-a') && !whereOf(call).includes('team-b'))
      ).toBe(false);
    });

    it('never serves cached schedule or on-call data across different schedule authorization filters', async () => {
      vi.mocked(getActiveOnCallShifts).mockClear();
      await getLiveDashboardSnapshot(admin('a1'), DEFAULT_LIVE_QUERY, { generation: '70' });
      await getLiveDashboardSnapshot(scoped('u1', ['team-a']), DEFAULT_LIVE_QUERY, {
        generation: '70',
      });
      await getLiveDashboardSnapshot(scoped('u2', ['team-a']), DEFAULT_LIVE_QUERY, {
        generation: '70',
      });
      await getLiveDashboardSnapshot(scoped('u3', ['team-z']), DEFAULT_LIVE_QUERY, {
        generation: '70',
      });
      const filters = vi
        .mocked(getActiveOnCallShifts)
        .mock.calls.map(call => JSON.stringify(call[1]));
      // Schedule visibility is user-specific for scoped viewers, so every distinct filter reads
      // separately and no result is ever reused across filters; the same viewer shares its own read.
      expect(new Set(filters).size).toBe(filters.length);
      expect(filters).toHaveLength(4);
      await getLiveDashboardSnapshot(scoped('u1', ['team-a']), DEFAULT_LIVE_QUERY, {
        generation: '71',
      });
      expect(vi.mocked(getActiveOnCallShifts).mock.calls).toHaveLength(4);
    });

    it('applies the viewer scope and redaction to the inspector detail read', async () => {
      prismaMock.incident.findFirst.mockResolvedValue({
        ...dbRow,
        dedupKey: 'k',
        runbookExecutions: [],
        automationDecision: {
          incidentId: 'inc-1',
          matchedRouteRuleName: 'rule',
          escalationPolicyNameSnapshot: null,
        },
        service: { ...dbRow.service, policy: null },
      });
      prismaMock.alert.count.mockResolvedValue(3);
      prismaMock.incidentWatcher.count.mockResolvedValue(1);
      const detail = await getLiveIncidentDetail(scoped('u1', ['team-a']), 'inc-1');
      const where = JSON.stringify(prismaMock.incident.findFirst.mock.calls[0][0].where);
      expect(where).toContain('"id":"inc-1"');
      expect(where).toContain('"assigneeId":"u1"');
      expect(where).toContain('"visibility":"PUBLIC"');
      expect(detail).toMatchObject({
        title: 'Restricted alert content',
        alertCount: 3,
        responderCount: 1,
      });
      prismaMock.incident.findFirst.mockResolvedValue(null);
      await expect(getLiveIncidentDetail(scoped('u9', []), 'inc-1')).resolves.toBeNull();
    });
  });
});
