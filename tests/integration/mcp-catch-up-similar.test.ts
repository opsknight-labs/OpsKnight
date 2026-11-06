// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpExecutable } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { principal, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import {
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';

setupMcpReadDatabase();

const unique = () => randomUUID().slice(0, 8);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: Error) => error.message
  );
type Envelope<T> = { data: { data: T } };

type Row = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  assignedToMe: boolean;
  openedSinceThen: boolean;
};
type CatchUp = {
  userId: string;
  scope: string;
  myTeamCount: number;
  filters: { serviceId: string | null; teamId: string | null; urgency: string | null };
  pagedMe: {
    count: number;
    items: {
      incident: { id: string };
      lastEventType: string;
      channels: string[];
      delivered: boolean;
    }[];
  };
  counts: { opened: number; resolved: number; active: number };
  active: Row[];
  assignedToMe: Row[];
  recentlyResolved: Row[];
  truncated: { active: boolean; recentlyResolved: boolean };
};
type Similar = {
  incidentId: string;
  basis: string;
  similar: {
    incident: { id: string; serviceName: string; resolvedAt: string | null };
    similarity: number;
    reasons: string[];
    resolutionKind: string | null;
    durationMinutes: number | null;
    lastNote: { excerpt: string; writtenBeforeResolution: boolean } | null;
  }[];
};

describe('catch up (getMyCatchUp, oncall_catch_up)', () => {
  it('is the curated read-only tool oncall_catch_up', () => {
    const operation = MCP_OPERATION_MAP.get('getMyCatchUp')!;
    expect(operation).toMatchObject({ status: 'CURATED', risk: 'R0', tool: 'oncall_catch_up' });
    expect(operation.requiredScopes).toEqual(['incidents:read']);
    expect(isMcpExecutable(operation)).toBe(true);
  });

  it('separates what opened, what resolved and what is still active, most urgent first', async () => {
    const caller = await principal('RESPONDER', ['incidents:read']);
    const service = await createTestService(`Catch-up ${unique()}`);
    const now = Date.now();
    const high = await createTestIncident(`High ${unique()}`, service.id, {
      urgency: 'HIGH',
      assigneeId: caller.user.id,
      createdAt: new Date(now - HOUR),
    });
    const low = await createTestIncident(`Low ${unique()}`, service.id, {
      urgency: 'LOW',
      createdAt: new Date(now - 2 * HOUR),
    });
    const stale = await createTestIncident(`Stale ${unique()}`, service.id, {
      urgency: 'MEDIUM',
      createdAt: new Date(now - 3 * DAY),
    });
    const fixed = await createTestIncident(`Fixed ${unique()}`, service.id, {
      status: 'RESOLVED',
      createdAt: new Date(now - 5 * HOUR),
      resolvedAt: new Date(now - 30 * MINUTE),
    });
    const longAgo = await createTestIncident(`Long ago ${unique()}`, service.id, {
      status: 'RESOLVED',
      createdAt: new Date(now - 5 * DAY),
      resolvedAt: new Date(now - 4 * DAY),
    });

    const result = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
      query: { hours: 12, limit: 25, scope: 'all' },
    })) as Envelope<CatchUp>;
    const data = result.data.data;
    expect(data.userId).toBe(caller.user.id);
    expect(data.scope).toBe('all');
    // Counts cover the whole readable set (other tests share the database), so bound from below.
    expect(data.counts.opened).toBeGreaterThanOrEqual(3);
    expect(data.counts.resolved).toBeGreaterThanOrEqual(1);
    expect(data.counts.active).toBeGreaterThanOrEqual(3);

    const activeIds = data.active.map(row => row.id);
    expect(activeIds).toEqual(expect.arrayContaining([high.id, low.id, stale.id]));
    expect(activeIds).not.toContain(fixed.id);
    // Most urgent first: HIGH before MEDIUM before LOW within what we created.
    const ours = activeIds.filter(id => [high.id, low.id, stale.id].includes(id));
    expect(ours).toEqual([high.id, stale.id, low.id]);
    expect(data.active.find(row => row.id === high.id)).toMatchObject({
      assignedToMe: true,
      openedSinceThen: true,
      serviceName: service.name,
    });
    expect(data.active.find(row => row.id === stale.id)?.openedSinceThen).toBe(false);
    expect(data.assignedToMe.map(row => row.id)).toContain(high.id);
    expect(data.assignedToMe.every(row => row.assignedToMe)).toBe(true);
    const resolvedIds = data.recentlyResolved.map(row => row.id);
    expect(resolvedIds).toContain(fixed.id);
    expect(resolvedIds).not.toContain(longAgo.id);
  });

  it('reports truncation and bounds its inputs', async () => {
    const caller = await principal('ADMIN', ['incidents:read']);
    const service = await createTestService(`Bounded ${unique()}`);
    for (let i = 0; i < 3; i += 1)
      await createTestIncident(`Open ${i} ${unique()}`, service.id, { assigneeId: caller.user.id });
    const limited = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
      query: { hours: 1, limit: 1 },
    })) as Envelope<CatchUp>;
    expect(limited.data.data.active).toHaveLength(1);
    expect(limited.data.data.truncated.active).toBe(true);
    const stamp = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    for (const query of [
      { hours: 169 },
      { hours: 0 },
      { limit: 26 },
      { unknown: 1 },
      { scope: 'everyone' },
      { urgency: 'URGENT' },
      { hours: 5, since: stamp(-HOUR) },
      { since: stamp(HOUR) },
      { since: stamp(-200 * HOUR) },
      { since: 'yesterday' },
    ])
      expect(await refused(callMcpOperation(caller.ctx(), 'getMyCatchUp', { query }))).not.toBe(
        'allowed'
      );
  });

  it('shows a scoped user only the incidents they may read, and needs the scope', async () => {
    const scoped = await principal('USER', ['incidents:read']);
    const service = await createTestService(`Scoped ${unique()}`);
    const mine = await createTestIncident(`Mine ${unique()}`, service.id, {
      assigneeId: scoped.user.id,
    });
    const notMine = await createTestIncident(`Not mine ${unique()}`, service.id);
    const result = (await callMcpOperation(scoped.ctx(), 'getMyCatchUp', {
      query: {},
    })) as Envelope<CatchUp>;
    const ids = result.data.data.active.map(row => row.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);

    const noScope = await principal('RESPONDER', ['schedules:read']);
    expect(await refused(callMcpOperation(noScope.ctx(), 'getMyCatchUp', {}))).not.toBe('allowed');
  });
});

describe('catch up scope, window, filters and pages', () => {
  it('defaults to what is mine (assigned, watched, my teams) and widens with scope=all', async () => {
    const caller = await principal('RESPONDER', ['incidents:read']);
    const team = await createTestTeam(`Mine ${unique()}`);
    await db.teamMember.create({ data: { teamId: team.id, userId: caller.user.id } });
    const teamService = await createTestService(`Team svc ${unique()}`, team.id);
    const otherService = await createTestService(`Other svc ${unique()}`);
    const viaTeam = await createTestIncident(`Via team ${unique()}`, teamService.id);
    const assigned = await createTestIncident(`Assigned ${unique()}`, otherService.id, {
      assigneeId: caller.user.id,
    });
    const watched = await createTestIncident(`Watched ${unique()}`, otherService.id);
    await db.incidentWatcher.create({ data: { incidentId: watched.id, userId: caller.user.id } });
    const unrelated = await createTestIncident(`Unrelated ${unique()}`, otherService.id);

    const ids = async (query: Record<string, unknown>) => {
      const result = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
        query: { limit: 25, ...query },
      })) as Envelope<CatchUp>;
      return { ids: result.data.data.active.map(row => row.id), data: result.data.data };
    };
    const mine = await ids({});
    expect(mine.data.scope).toBe('mine');
    expect(mine.data.myTeamCount).toBe(1);
    expect(mine.ids).toEqual(expect.arrayContaining([viaTeam.id, assigned.id, watched.id]));
    expect(mine.ids).not.toContain(unrelated.id);
    expect((await ids({ scope: 'all' })).ids).toContain(unrelated.id);

    // Filters narrow further and are echoed back.
    const byService = await ids({ scope: 'all', serviceId: teamService.id });
    expect(byService.ids).toEqual([viaTeam.id]);
    expect(byService.data.filters.serviceId).toBe(teamService.id);
    expect((await ids({ teamId: team.id })).ids).toEqual([viaTeam.id]);
    await db.incident.update({ where: { id: watched.id }, data: { urgency: 'LOW' } });
    expect((await ids({ urgency: 'LOW' })).ids).toContain(watched.id);
    expect((await ids({ urgency: 'LOW' })).ids).not.toContain(assigned.id);
  });

  it('tells a person on no team why "mine" is empty', async () => {
    const loner = await principal('RESPONDER', ['incidents:read']);
    const result = (await callMcpOperation(loner.ctx(), 'getMyCatchUp', {
      query: {},
    })) as Envelope<CatchUp>;
    expect(result.data.data.myTeamCount).toBe(0);
    expect(result.data.data.active).toEqual([]);
  });

  it('starts at an exact time with since, and never mixes it with hours', async () => {
    const caller = await principal('ADMIN', ['incidents:read']);
    const service = await createTestService(`Since ${unique()}`);
    const now = Date.now();
    const recent = await createTestIncident(`Recent ${unique()}`, service.id, {
      createdAt: new Date(now - 30 * MINUTE),
    });
    const older = await createTestIncident(`Older ${unique()}`, service.id, {
      createdAt: new Date(now - 3 * HOUR),
    });
    const result = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
      query: { since: new Date(now - HOUR).toISOString(), scope: 'all', limit: 25 },
    })) as Envelope<CatchUp>;
    const since = result.data.data.active.reduce(
      (all, row) => ({ ...all, [row.id]: row.openedSinceThen }),
      {} as Record<string, boolean>
    );
    expect(since[recent.id]).toBe(true);
    expect(since[older.id]).toBe(false);
  });

  it('shows which incidents paged me, from my own notifications only', async () => {
    const caller = await principal('RESPONDER', ['incidents:read']);
    const other = await createTestUser();
    const service = await createTestService(`Paged ${unique()}`);
    const paged = await createTestIncident(`Paged me ${unique()}`, service.id, {
      assigneeId: caller.user.id,
    });
    const onlyOther = await createTestIncident(`Paged them ${unique()}`, service.id);
    const mk = (
      incidentId: string,
      userId: string,
      channel: 'PUSH' | 'SMS',
      status: 'SENT' | 'FAILED'
    ) =>
      db.notification.create({
        data: { incidentId, userId, channel, status, eventType: 'triggered' },
      });
    await mk(paged.id, caller.user.id, 'PUSH', 'SENT');
    await mk(paged.id, caller.user.id, 'SMS', 'FAILED');
    await mk(onlyOther.id, other.id, 'PUSH', 'SENT');

    const result = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
      query: { scope: 'all' },
    })) as Envelope<CatchUp>;
    const items = result.data.data.pagedMe.items;
    expect(items.map(item => item.incident.id)).toEqual([paged.id]);
    expect(items[0]).toMatchObject({
      lastEventType: 'triggered',
      channels: ['PUSH', 'SMS'],
      delivered: true,
    });
    expect(JSON.stringify(result.data.data)).not.toContain(other.id);
  });

  it('never reports a page for an incident the caller may not read', async () => {
    const scoped = await principal('USER', ['incidents:read']);
    const service = await createTestService(`Hidden ${unique()}`);
    const hidden = await createTestIncident(`Hidden page ${unique()}`, service.id);
    await db.notification.create({
      data: {
        incidentId: hidden.id,
        userId: scoped.user.id,
        channel: 'PUSH',
        status: 'SENT',
        eventType: 'triggered',
      },
    });
    const result = (await callMcpOperation(scoped.ctx(), 'getMyCatchUp', {
      query: { scope: 'all' },
    })) as Envelope<CatchUp>;
    expect(result.data.data.pagedMe).toMatchObject({ count: 0, items: [] });
  });
});

describe('similar incidents (listSimilarIncidents, incident_find_similar)', () => {
  it('is the curated read-only tool incident_find_similar', () => {
    const operation = MCP_OPERATION_MAP.get('listSimilarIncidents')!;
    expect(operation).toMatchObject({
      status: 'CURATED',
      risk: 'R0',
      tool: 'incident_find_similar',
    });
    expect(operation.requiredScopes).toEqual(['incidents:read']);
  });

  it('finds past resolved incidents by title overlap and says why and how they ended', async () => {
    const caller = await principal('RESPONDER', ['incidents:read']);
    const author = await createTestUser();
    const tag = unique();
    const service = await createTestService(`Payments ${tag}`);
    const batch = await createTestService(`Batch ${tag}`);
    const now = Date.now();
    const source = await createTestIncident(`Checkout latency spike ${tag}`, service.id, {
      priority: 'P2',
    });
    const match = await createTestIncident(`Checkout latency spike on gateway ${tag}`, service.id, {
      status: 'RESOLVED',
      priority: 'P2',
      resolutionKind: 'MANUAL',
      createdAt: new Date(now - 10 * DAY),
      resolvedAt: new Date(now - 10 * DAY + 90 * MINUTE),
    });
    await db.incidentNote.create({
      data: {
        incidentId: match.id,
        userId: author.id,
        content: `Rolled back the connection pool change. ${'x'.repeat(600)}`,
        createdAt: new Date(now - 10 * DAY + 80 * MINUTE),
      },
    });
    const sameServiceOnly = await createTestIncident(`Disk quota exceeded ${tag}`, service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(now - 5 * DAY),
    });
    const stillOpen = await createTestIncident(`Checkout latency spike open ${tag}`, service.id);
    const otherService = await createTestIncident(`Nightly batch failed ${tag}`, batch.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(now - 3 * DAY),
    });

    const result = (await callMcpOperation(caller.ctx(), 'listSimilarIncidents', {
      path: { id: source.id },
    })) as Envelope<Similar>;
    const data = result.data.data;
    expect(data.incidentId).toBe(source.id);
    expect(data.basis).toBe('TITLE_AND_SERVICE');
    const ids = data.similar.map(row => row.incident.id);
    expect(ids[0]).toBe(match.id);
    // A shared service alone is not similarity, an open incident has no outcome, other topics stay out.
    expect(ids).not.toContain(sameServiceOnly.id);
    expect(ids).not.toContain(stillOpen.id);
    expect(ids).not.toContain(otherService.id);
    expect(ids).not.toContain(source.id);

    const row = data.similar[0]!;
    expect(row.reasons).toEqual(['TITLE_OVERLAP', 'SAME_SERVICE', 'SAME_PRIORITY']);
    expect(row.similarity).toBeGreaterThan(0.5);
    expect(row.similarity).toBeLessThanOrEqual(1);
    expect(row).toMatchObject({ resolutionKind: 'MANUAL', durationMinutes: 90 });
    expect(row.incident.serviceName).toBe(service.name);
    expect(row.lastNote!.excerpt.startsWith('Rolled back the connection pool change.')).toBe(true);
    // Excerpts are bounded (400 characters plus an ellipsis).
    expect(row.lastNote!.excerpt.length).toBeLessThanOrEqual(401);
  });

  it('only searches incidents the caller may read, bounds its limit and needs the scope', async () => {
    const scoped = await principal('USER', ['incidents:read']);
    const tag = unique();
    const service = await createTestService(`Scoped ${tag}`);
    const hidden = await createTestIncident(`Checkout latency spike ${tag}`, service.id);
    const mine = await createTestIncident(`Checkout latency spike mine ${tag}`, service.id, {
      assigneeId: scoped.user.id,
    });
    await createTestIncident(`Checkout latency spike old ${tag}`, service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - DAY),
    });
    const visiblePast = await createTestIncident(`Checkout latency spike past ${tag}`, service.id, {
      status: 'RESOLVED',
      assigneeId: scoped.user.id,
      resolvedAt: new Date(Date.now() - DAY),
    });

    // The source itself must be readable.
    expect(
      await refused(
        callMcpOperation(scoped.ctx(), 'listSimilarIncidents', { path: { id: hidden.id } })
      )
    ).not.toBe('allowed');
    const result = (await callMcpOperation(scoped.ctx(), 'listSimilarIncidents', {
      path: { id: mine.id },
    })) as Envelope<Similar>;
    // Only the resolved incident this user can read is a candidate; the unreadable one is not.
    expect(result.data.data.similar.map(row => row.incident.id)).toEqual([visiblePast.id]);

    for (const query of [{ limit: 11 }, { limit: 0 }, { extra: 1 }])
      expect(
        await refused(
          callMcpOperation(scoped.ctx(), 'listSimilarIncidents', { path: { id: mine.id }, query })
        )
      ).not.toBe('allowed');
    const noScope = await principal('RESPONDER', ['schedules:read']);
    expect(
      await refused(
        callMcpOperation(noScope.ctx(), 'listSimilarIncidents', { path: { id: mine.id } })
      )
    ).not.toBe('allowed');
  });
});

describe('similar incidents, round 5 matching', () => {
  const caller = async () => principal('RESPONDER', ['incidents:read']);
  const id = (result: Envelope<Similar>) => result.data.data.similar.map(row => row.incident.id);

  it('folds plurals, tenses and synonyms so "db timed out" finds "database timeout"', async () => {
    const who = await caller();
    const tag = unique();
    const service = await createTestService(`Syn ${tag}`);
    const now = Date.now();
    const source = await createTestIncident(`Postgres timeouts on orders ${tag}`, service.id);
    const match = await createTestIncident(`Database timeout on order writes ${tag}`, service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(now - DAY),
    });
    const result = (await callMcpOperation(who.ctx(), 'listSimilarIncidents', {
      path: { id: source.id },
    })) as Envelope<Similar>;
    expect(id(result)).toContain(match.id);
  });

  it('uses the description when titles are short', async () => {
    const who = await caller();
    const tag = unique();
    const service = await createTestService(`Desc ${tag}`);
    const other = await createTestService(`Desc other ${tag}`);
    const source = await createTestIncident(`Payments ${tag}`, service.id, {
      description: 'checkout requests fail with gateway connection pool exhausted',
    });
    const match = await createTestIncident(`Payments degraded ${tag}`, other.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - DAY),
      description: 'checkout fails: gateway connection pool exhausted after deploy',
    });
    const result = (await callMcpOperation(who.ctx(), 'listSimilarIncidents', {
      path: { id: source.id },
    })) as Envelope<Similar>;
    expect(id(result)).toContain(match.id);
  });

  it('does not let a busy service crowd an older match on another service out', async () => {
    const who = await caller();
    const tag = unique();
    const busy = await createTestService(`Busy ${tag}`);
    const quiet = await createTestService(`Quiet ${tag}`);
    const source = await createTestIncident(`Cache stampede on sessions ${tag}`, busy.id);
    const old = await createTestIncident(`Cache stampede on session store ${tag}`, quiet.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 200 * DAY),
    });
    // More unrelated resolved incidents on the busy service than one pool holds.
    await db.incident.createMany({
      data: Array.from({ length: 160 }, (_, n) => ({
        title: `Noise ${n} ${tag}`,
        serviceId: busy.id,
        status: 'RESOLVED' as const,
        urgency: 'LOW' as const,
        resolvedAt: new Date(Date.now() - HOUR * (n + 1)),
      })),
    });
    const result = (await callMcpOperation(who.ctx(), 'listSimilarIncidents', {
      path: { id: source.id },
    })) as Envelope<Similar>;
    expect(id(result)).toContain(old.id);
    expect(result.data.data.similar.every(row => row.similarity <= 1)).toBe(true);
  });

  it('shows the note written at resolution, and flags a later one', async () => {
    const who = await caller();
    const tag = unique();
    const service = await createTestService(`Notes ${tag}`);
    const now = Date.now();
    const source = await createTestIncident(`Queue backlog growing ${tag}`, service.id);
    const resolvedAt = new Date(now - 2 * DAY);
    const match = await createTestIncident(`Queue backlog growing fast ${tag}`, service.id, {
      status: 'RESOLVED',
      resolvedAt,
    });
    await db.incidentNote.createMany({
      data: [
        {
          incidentId: match.id,
          content: 'Scaled workers to 8.',
          createdAt: new Date(resolvedAt.getTime() - 10 * MINUTE),
        },
        {
          incidentId: match.id,
          content: 'Follow-up: raised the alert threshold.',
          createdAt: new Date(resolvedAt.getTime() + DAY),
        },
      ],
    });
    const result = (await callMcpOperation(who.ctx(), 'listSimilarIncidents', {
      path: { id: source.id },
    })) as Envelope<Similar>;
    const row = result.data.data.similar.find(entry => entry.incident.id === match.id)!;
    expect(row.lastNote).toMatchObject({
      excerpt: 'Scaled workers to 8.',
      writtenBeforeResolution: true,
    });
  });
});

type OnCallNow = {
  iAmOnCall: boolean;
  gaps: number;
  truncated: boolean;
  scope: string;
  schedules: {
    scheduleId: string;
    scheduleName: string;
    onCall: { userId: string; name: string | null }[];
    next: { userId: string } | null;
    gap: boolean;
  }[];
};

describe('on call now (getOnCallNow, oncall_now)', () => {
  const ask = async (who: Awaited<ReturnType<typeof principal>>, query: Record<string, unknown>) =>
    ((await callMcpOperation(who.ctx(), 'getOnCallNow', { query })) as Envelope<OnCallNow>).data
      .data;

  it('is the curated read-only tool oncall_now', () => {
    const operation = MCP_OPERATION_MAP.get('getOnCallNow')!;
    expect(operation).toMatchObject({ status: 'CURATED', risk: 'R0', tool: 'oncall_now' });
    expect(operation.requiredScopes).toEqual(['schedules:read']);
  });

  it('keeps schedules I or a teammate take part in by default, everything with scope=all', async () => {
    const me = await principal('RESPONDER', ['schedules:read']);
    const teammate = await createTestUser({ name: `Teammate ${unique()}` });
    const stranger = await createTestUser({ name: `Stranger ${unique()}` });
    const team = await createTestTeam(`Rota ${unique()}`);
    await db.teamMember.createMany({
      data: [
        { teamId: team.id, userId: me.user.id },
        { teamId: team.id, userId: teammate.id },
      ],
    });
    const start = new Date(Date.now() - HOUR);
    const mineSchedule = await createTestOnCallSchedule(`Mine ${unique()}`, [
      { start, rotationLengthHours: 24, userIds: [me.user.id] },
    ]);
    const teammateSchedule = await createTestOnCallSchedule(`Teammate ${unique()}`, [
      { start, rotationLengthHours: 24, userIds: [teammate.id] },
    ]);
    const strangerSchedule = await createTestOnCallSchedule(`Stranger ${unique()}`, [
      { start, rotationLengthHours: 24, userIds: [stranger.id] },
    ]);

    const mine = await ask(me, {});
    const ids = mine.schedules.map(row => row.scheduleId);
    expect(mine.scope).toBe('mine');
    expect(ids).toEqual(expect.arrayContaining([mineSchedule.id, teammateSchedule.id]));
    expect(ids).not.toContain(strangerSchedule.id);
    expect(mine.iAmOnCall).toBe(true);
    const mineRow = mine.schedules.find(row => row.scheduleId === mineSchedule.id)!;
    expect(mineRow.onCall.map(entry => entry.userId)).toEqual([me.user.id]);
    expect(mineRow.gap).toBe(false);
    // Names only: no contact details leak into the output.
    expect(JSON.stringify(mine)).not.toMatch(/@|email|phone/i);

    const all = await ask(me, { scope: 'all' });
    expect(all.schedules.map(row => row.scheduleId)).toContain(strangerSchedule.id);
  });

  it('flags a schedule nobody is on call for, and reports truncation', async () => {
    const admin = await principal('ADMIN', ['schedules:read']);
    const empty = await createTestOnCallSchedule(`Empty ${unique()}`, []);
    const all = await ask(admin, { scope: 'all', limit: 50 });
    const row = all.schedules.find(entry => entry.scheduleId === empty.id);
    expect(row).toMatchObject({ gap: true, onCall: [], next: null });
    expect(all.gaps).toBeGreaterThanOrEqual(1);
    const limited = await ask(admin, { scope: 'all', limit: 1 });
    expect(limited.schedules).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it('shows a scoped user only the schedules they may read, bounds inputs and needs the scope', async () => {
    const scoped = await principal('USER', ['schedules:read']);
    const other = await createTestUser();
    const hidden = await createTestOnCallSchedule(`Hidden ${unique()}`, [
      { start: new Date(Date.now() - HOUR), rotationLengthHours: 24, userIds: [other.id] },
    ]);
    const result = await ask(scoped, { scope: 'all' });
    expect(result.schedules.map(row => row.scheduleId)).not.toContain(hidden.id);
    for (const query of [{ limit: 51 }, { limit: 0 }, { scope: 'team' }, { extra: 1 }])
      expect(await refused(callMcpOperation(scoped.ctx(), 'getOnCallNow', { query }))).not.toBe(
        'allowed'
      );
    const noScope = await principal('RESPONDER', ['incidents:read']);
    expect(await refused(callMcpOperation(noScope.ctx(), 'getOnCallNow', {}))).not.toBe('allowed');
  });
});
