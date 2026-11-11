import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import type { OpsInsightItem, OpsInsightScope } from '@/lib/intelligence/ops-insights/contract';
import { decideInsight } from '@/lib/intelligence/ops-insights/decisions';
import {
  dueOpsInsightScopesSql,
  enqueueOpsInsights,
  OPS_INSIGHT_HANDLERS,
  resetOpsInsightsSchedule,
  runOpsInsights,
  scheduleOpsInsightsWork,
} from '@/lib/intelligence/ops-insights/handlers';
import type { AnyOpsInsightProducer } from '@/lib/intelligence/ops-insights/producer';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { purgeOpsInsights, upsertInsights } from '@/lib/intelligence/ops-insights/store';
import {
  countOpenInsightsForScopes,
  listInsightsForScope,
  listInsightsInbox,
} from '@/lib/intelligence/ops-insights/view';
import {
  getIntelligenceSettings,
  updateIntelligenceSettings,
} from '@/lib/intelligence/settings/service';
import { Prisma } from '@prisma/client';
import {
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
  resetOpsInsightsSchedule();
});

const ALL_ON = {
  opsInsightsEnabled: true,
  opsInsightsAutomationEnabled: true,
  opsInsightsEscalationEnabled: true,
  opsInsightsOnCallEnabled: true,
  opsInsightsPostmortemsEnabled: true,
  opsInsightsRunbooksEnabled: true,
  opsInsightsNotificationsEnabled: true,
};

async function switchOn(overrides: Partial<typeof ALL_ON> = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const current = await getIntelligenceSettings();
  return updateOpsInsightSwitches(
    { ...ALL_ON, ...overrides, expectedRevision: current.revision },
    { actorId: admin.id, source: 'UI' }
  );
}

async function actorFor(
  role: 'ADMIN' | 'RESPONDER' | 'USER' | 'AUDITOR',
  teamId?: string,
  teamRole: 'OWNER' | 'MEMBER' = 'MEMBER'
) {
  const user = await createTestUser({ role });
  if (teamId) await db.teamMember.create({ data: { userId: user.id, teamId, role: teamRole } });
  const actor = await resolveUserActor(user.id);
  if (!actor) throw new Error('actor');
  return actor;
}

const item = (key: string, overrides: Partial<OpsInsightItem> = {}): OpsInsightItem => ({
  key,
  severity: 'WARNING',
  title: `Insight ${key}`,
  summary: 'Something to look at.',
  evidence: { facts: [{ label: 'Count', value: '3' }] },
  ...overrides,
});

const serviceScope = (id: string): OpsInsightScope => ({ type: 'SERVICE', id });

async function alerts(
  serviceId: string,
  count: number,
  at: Date,
  severity: string | null = 'critical'
) {
  await db.alert.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      serviceId,
      payload: {},
      severity,
      createdAt: new Date(at.getTime() - index * 1000),
    })),
  });
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

describe('the insight store', () => {
  it('updates on the unique key instead of duplicating, and resolves what is no longer produced', async () => {
    const service = await createTestService('Svc');
    const scope = serviceScope(service.id);
    await upsertInsights(scope, 'test.kind', [item('a'), item('b')], { area: 'automation' });
    const second = await upsertInsights(
      scope,
      'test.kind',
      [item('a', { severity: 'CRITICAL', title: 'Worse' })],
      { area: 'automation' }
    );
    expect(second).toMatchObject({ written: 1, resolved: 1, rejected: 0 });
    const rows = await db.opsInsight.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map(row => [row.key, row.status, row.severity, row.title])).toEqual([
      ['a', 'OPEN', 'CRITICAL', 'Worse'],
      ['b', 'RESOLVED', 'WARNING', 'Insight b'],
    ]);
    expect(rows[1].resolvedAt).not.toBeNull();
  });

  it('keeps a dismissal while the insight is still produced, and reopens a resolved one that returns', async () => {
    const service = await createTestService('Svc');
    const scope = serviceScope(service.id);
    await upsertInsights(scope, 'test.kind', [item('a'), item('b')], { area: 'automation' });
    await db.opsInsight.updateMany({ where: { key: 'a' }, data: { status: 'DISMISSED' } });
    await upsertInsights(scope, 'test.kind', [item('a')], { area: 'automation' });
    await upsertInsights(scope, 'test.kind', [item('a'), item('b')], { area: 'automation' });
    const rows = await db.opsInsight.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map(row => [row.key, row.status])).toEqual([
      ['a', 'DISMISSED'],
      ['b', 'OPEN'],
    ]);
    expect(rows[1].resolvedAt).toBeNull();
  });

  it('never lets an older generation overwrite a newer one', async () => {
    const service = await createTestService('Svc');
    const scope = serviceScope(service.id);
    await upsertInsights(scope, 'test.kind', [item('a', { title: 'Newer' })], {
      area: 'automation',
      generation: 9,
    });
    const stale = await upsertInsights(scope, 'test.kind', [], {
      area: 'automation',
      generation: 4,
    });
    expect(stale.resolved).toBe(0);
    await upsertInsights(scope, 'test.kind', [item('a', { title: 'Older' })], {
      area: 'automation',
      generation: 4,
    });
    expect(await db.opsInsight.findFirstOrThrow()).toMatchObject({
      title: 'Newer',
      status: 'OPEN',
    });
  });

  it('rejects items that break the contract: oversized evidence and off-site links', async () => {
    const service = await createTestService('Svc');
    const result = await upsertInsights(
      serviceScope(service.id),
      'test.kind',
      [
        item('big', {
          evidence: {
            facts: Array.from({ length: 12 }, (_, index) => ({
              label: `Fact ${index}`,
              value: 'x'.repeat(160),
            })),
            examples: Array.from({ length: 5 }, () => ({ label: 'y'.repeat(160) })),
            window: 'z'.repeat(80),
          },
          summary: 's'.repeat(401),
        }),
        item('link', { draftHref: '//evil.example/x' }),
        item('ok'),
      ],
      { area: 'automation' }
    );
    expect(result).toMatchObject({ written: 1, rejected: 2 });
  });
});

describe('the lane job with the integration-health producer', () => {
  async function run(serviceId: string, generation = 1) {
    return runOpsInsights(
      { subjectKey: `SERVICE:${serviceId}`, generation, force: false },
      await getIntelligenceSettings()
    );
  }

  it('finds a service that went silent, with the evidence', async () => {
    await switchOn();
    const service = await createTestService('Quiet');
    // 28 alerts in the week before the last one (4 a day), then nothing for 3 days.
    for (let day = 0; day < 7; day += 1) await alerts(service.id, 4, hoursAgo(72 + day * 24));
    expect(await run(service.id)).toBe('computed');
    const rows = await db.opsInsight.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'integration.health',
      key: 'silent',
      area: 'automation',
      severity: 'WARNING',
      status: 'OPEN',
      title: 'No alerts for 3 days',
      draftHref: `/services/${service.id}/integrations`,
    });
    expect(rows[0].evidence).toMatchObject({
      facts: [
        { label: 'Time since the last alert', value: '3 days' },
        { label: 'Usual alerts per day', value: '4' },
      ],
    });
  });

  it('finds a volume step and payloads without a severity', async () => {
    await switchOn();
    const service = await createTestService('Loud');
    for (let day = 1; day <= 7; day += 1) await alerts(service.id, 10, hoursAgo(day * 24 + 6));
    await alerts(service.id, 80, hoursAgo(1), null);
    expect(await run(service.id)).toBe('computed');
    const rows = await db.opsInsight.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map(row => [row.key, row.severity, row.title])).toEqual([
      ['missing-severity', 'INFO', '53% of recent alerts have no severity'],
      ['volume-step', 'WARNING', 'Alert volume is 8 times the usual'],
    ]);
  });

  it('says nothing about a healthy service or one that never sent an alert', async () => {
    await switchOn();
    const healthy = await createTestService('Healthy');
    for (let day = 0; day < 8; day += 1) await alerts(healthy.id, 10, hoursAgo(day * 24 + 1));
    const fresh = await createTestService('Fresh');
    expect(await run(healthy.id)).toBe('computed');
    expect(await run(fresh.id)).toBe('computed');
    expect(await db.opsInsight.count()).toBe(0);
  });

  it('skips unchanged inputs: nothing is rewritten until something changes', async () => {
    await switchOn();
    const service = await createTestService('Quiet');
    for (let day = 0; day < 7; day += 1) await alerts(service.id, 4, hoursAgo(100 + day * 24));
    expect(await run(service.id, 1)).toBe('computed');
    const before = await db.opsInsight.findFirstOrThrow();
    expect(await run(service.id, 2)).toBe('unchanged');
    const after = await db.opsInsight.findFirstOrThrow();
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.generation).toBe(1);
    // The source speaks again: inputs change, and the insight resolves.
    await alerts(service.id, 1, hoursAgo(0));
    expect(await run(service.id, 3)).toBe('computed');
    expect((await db.opsInsight.findFirstOrThrow()).status).toBe('RESOLVED');
  });

  it('does nothing while the feature is off, and stops reporting an area that is switched off', async () => {
    const service = await createTestService('Quiet');
    for (let day = 0; day < 7; day += 1) await alerts(service.id, 4, hoursAgo(100 + day * 24));
    expect(await run(service.id)).toBe('off');
    expect(await db.opsInsight.count()).toBe(0);

    await switchOn();
    await run(service.id, 2);
    expect((await db.opsInsight.findFirstOrThrow()).status).toBe('OPEN');
    await switchOn({ opsInsightsAutomationEnabled: false });
    expect(await run(service.id, 3)).toBe('computed');
    expect((await db.opsInsight.findFirstOrThrow()).status).toBe('RESOLVED');
  });

  it('removes the insights of a scope that no longer exists', async () => {
    await switchOn();
    await upsertInsights(serviceScope('gone'), 'test.kind', [item('a')], { area: 'automation' });
    expect(await run('gone')).toBe('gone');
    expect(await db.opsInsight.count()).toBe(0);
  });

  it('runs every producer of the scope in one item and isolates kinds', async () => {
    await switchOn();
    const service = await createTestService('Svc');
    const producer = (kind: string, keys: string[]): AnyOpsInsightProducer => ({
      kind,
      version: 1,
      area: 'runbooks',
      scopeType: 'SERVICE',
      loadInput: async () => ({ keys }),
      derive: (input: { keys: string[] }) => input.keys.map(key => item(key)),
    });
    const outcome = await runOpsInsights(
      { subjectKey: `SERVICE:${service.id}`, generation: 1 },
      await getIntelligenceSettings(),
      { producers: [producer('one', ['a']), producer('two', ['a', 'b'])] }
    );
    expect(outcome).toBe('computed');
    const rows = await db.opsInsight.findMany({ orderBy: [{ kind: 'asc' }, { key: 'asc' }] });
    expect(rows.map(row => `${row.kind}/${row.key}/${row.area}`)).toEqual([
      'one/a/runbooks',
      'two/a/runbooks',
      'two/b/runbooks',
    ]);
  });
});

describe('scheduling', () => {
  const handlers = OPS_INSIGHT_HANDLERS;

  it('enqueues nothing while off, then each due scope once a day with jitter', async () => {
    const a = await createTestService('A');
    const b = await createTestService('B');
    expect(await scheduleOpsInsightsWork(Date.now(), handlers)).toBe(0);
    expect(await db.intelligenceWorkItem.count()).toBe(0);

    await switchOn();
    resetOpsInsightsSchedule();
    const now = Date.now();
    expect(await scheduleOpsInsightsWork(now, handlers, { random: () => 0.5 })).toBe(2);
    const queued = await db.intelligenceWorkItem.findMany({ orderBy: { subjectKey: 'asc' } });
    expect(queued.map(row => [row.kind, row.subjectKey]).sort()).toEqual(
      [
        ['OPS_INSIGHTS', `SERVICE:${a.id}`],
        ['OPS_INSIGHTS', `SERVICE:${b.id}`],
      ].sort()
    );
    expect(queued[0].scheduledAt.getTime()).toBeGreaterThan(now);
    // Within the scan interval nothing is read or enqueued again.
    expect(await scheduleOpsInsightsWork(now + 1000, handlers)).toBe(0);

    // Computed scopes are not due again until a day has passed.
    await runOpsInsights(
      { subjectKey: `SERVICE:${a.id}`, generation: 1 },
      await getIntelligenceSettings()
    );
    const due = await db.$queryRaw<Array<{ id: string }>>(dueOpsInsightScopesSql('SERVICE', 10));
    expect(due.map(row => row.id)).toEqual([b.id]);
    await db.opsInsightScopeState.updateMany({ data: { computedAt: hoursAgo(25) } });
    const dueLater = await db.$queryRaw<Array<{ id: string }>>(
      dueOpsInsightScopesSql('SERVICE', 10)
    );
    expect(dueLater.map(row => row.id)).toEqual([b.id, a.id]);
  });

  it('enqueues a scope on change only while the feature is on, coalesced', async () => {
    const scope = serviceScope('svc-1');
    expect(await enqueueOpsInsights(scope)).toBe(0);
    await switchOn();
    await enqueueOpsInsights(scope);
    await enqueueOpsInsights([scope, scope]);
    expect(await db.intelligenceWorkItem.count()).toBe(1);
  });

  it('reads due scopes through the primary keys, never a sequential scan of the state table', async () => {
    const plan = await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
        Prisma.sql`EXPLAIN (FORMAT JSON) ${dueOpsInsightScopesSql('SERVICE', 200)}`
      );
    });
    const text = JSON.stringify(plan);
    expect(text).toMatch(/OpsInsightScopeState_pkey|idx_ops_insight_scope_due/);
    expect(text).not.toMatch(/"Node Type":\s*"Seq Scan"/);
  });
});

describe('reading insights', () => {
  async function world() {
    await switchOn();
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const serviceA = await createTestService('A', teamA.id);
    const serviceB = await createTestService('B', teamB.id);
    await upsertInsights(
      serviceScope(serviceA.id),
      'test.kind',
      [item('warn'), item('info', { severity: 'INFO' })],
      { area: 'automation' }
    );
    await upsertInsights(
      serviceScope(serviceB.id),
      'test.kind',
      [item('crit', { severity: 'CRITICAL' })],
      { area: 'automation' }
    );
    return { teamA, teamB, serviceA, serviceB };
  }

  it('shows a team-scoped reader only the scopes their teams can read', async () => {
    const { teamA, serviceA, serviceB } = await world();
    const responder = await actorFor('USER', teamA.id);
    const admin = await actorFor('ADMIN');

    expect(
      (await listInsightsForScope(responder, serviceScope(serviceA.id))).map(row => row.key)
    ).toEqual(['warn', 'info']);
    expect(await listInsightsForScope(responder, serviceScope(serviceB.id))).toEqual([]);

    const counts = await countOpenInsightsForScopes(responder, 'SERVICE', [
      serviceA.id,
      serviceB.id,
    ]);
    expect([...counts.entries()]).toEqual([[serviceA.id, { open: 2, highest: 'WARNING' }]]);
    const adminCounts = await countOpenInsightsForScopes(admin, 'SERVICE', [
      serviceA.id,
      serviceB.id,
    ]);
    expect(adminCounts.get(serviceB.id)).toEqual({ open: 1, highest: 'CRITICAL' });

    const inbox = await listInsightsInbox(responder);
    expect(inbox.items.map(row => row.key)).toEqual(['warn', 'info']);
    expect(inbox.items[0]).toMatchObject({
      scopeHref: `/services/${serviceA.id}`,
      scopeName: serviceA.name,
    });
    const adminInbox = await listInsightsInbox(admin, { limit: 2 });
    expect(adminInbox.items.map(row => row.key)).toEqual(['crit', 'warn']);
    const rest = await listInsightsInbox(admin, { cursor: adminInbox.nextCursor });
    expect(rest.items.map(row => row.key)).toEqual(['info']);
    expect(rest.nextCursor).toBeNull();
  });

  it('hides everything while the feature or the area is off, without deleting it', async () => {
    const { serviceA } = await world();
    const admin = await actorFor('ADMIN');
    await switchOn({ opsInsightsAutomationEnabled: false });
    expect(await listInsightsForScope(admin, serviceScope(serviceA.id))).toEqual([]);
    expect((await countOpenInsightsForScopes(admin, 'SERVICE', [serviceA.id])).size).toBe(0);
    expect((await listInsightsInbox(admin)).items).toEqual([]);
    expect(await db.opsInsight.count()).toBe(3);
  });

  it('shows a person-scoped insight to that person, their team owner and admins only', async () => {
    await switchOn();
    const team = await createTestTeam('Team');
    const other = await createTestTeam('Other');
    const person = await actorFor('RESPONDER', team.id);
    const teammate = await actorFor('RESPONDER', team.id);
    const lead = await actorFor('RESPONDER', team.id, 'OWNER');
    const otherLead = await actorFor('RESPONDER', other.id, 'OWNER');
    const admin = await actorFor('ADMIN');
    const scope: OpsInsightScope = { type: 'USER', id: person.id };
    await upsertInsights(scope, 'test.load', [item('night')], { area: 'onCall' });

    for (const [actor, visible] of [
      [person, true],
      [lead, true],
      [admin, true],
      [teammate, false],
      [otherLead, false],
    ] as const) {
      expect((await listInsightsForScope(actor, scope)).length, actor.id).toBe(visible ? 1 : 0);
      expect((await listInsightsInbox(actor)).items.length, actor.id).toBe(visible ? 1 : 0);
      expect((await countOpenInsightsForScopes(actor, 'USER', [person.id])).size).toBe(
        visible ? 1 : 0
      );
    }
  });
});

describe('deciding on an insight', () => {
  async function world() {
    await switchOn();
    const team = await createTestTeam('Team');
    const service = await createTestService('Svc', team.id);
    await upsertInsights(serviceScope(service.id), 'test.kind', [item('a')], {
      area: 'automation',
    });
    const insight = await db.opsInsight.findFirstOrThrow();
    return { team, service, insight };
  }

  it('accepts, dismisses and reopens with an audit entry, and survives recomputation', async () => {
    const { team, service, insight } = await world();
    const responder = await actorFor('RESPONDER', team.id);
    expect(await decideInsight(responder, { id: insight.id, decision: 'accept' })).toEqual({
      status: 'ACCEPTED',
      changed: true,
    });
    expect(await decideInsight(responder, { id: insight.id, decision: 'accept' })).toEqual({
      status: 'ACCEPTED',
      changed: false,
    });
    await decideInsight(responder, { id: insight.id, decision: 'dismiss' });
    expect(await db.opsInsight.findFirstOrThrow()).toMatchObject({
      status: 'DISMISSED',
      decidedById: responder.id,
    });
    await upsertInsights(serviceScope(service.id), 'test.kind', [item('a')], {
      area: 'automation',
    });
    expect((await db.opsInsight.findFirstOrThrow()).status).toBe('DISMISSED');
    expect(await listInsightsForScope(responder, serviceScope(service.id))).toEqual([]);

    await decideInsight(responder, { id: insight.id, decision: 'reopen' });
    expect(await db.opsInsight.findFirstOrThrow()).toMatchObject({
      status: 'OPEN',
      decidedById: null,
    });
    const audits = await db.auditLog.findMany({
      where: { action: { startsWith: 'intelligence.ops_insight.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map(row => row.action)).toEqual([
      'intelligence.ops_insight.accept',
      'intelligence.ops_insight.dismiss',
      'intelligence.ops_insight.reopen',
    ]);
  });

  it('reports an insight the actor cannot see as not found, and refuses actors without the capability', async () => {
    const { insight } = await world();
    const outsider = await actorFor('USER', (await createTestTeam('Other')).id);
    await expect(
      decideInsight(outsider, { id: insight.id, decision: 'dismiss' })
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      decideInsight(outsider, { id: 'missing', decision: 'dismiss' })
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    const viewer = await actorFor('AUDITOR');
    await expect(
      decideInsight(viewer, { id: insight.id, decision: 'dismiss' })
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect((await db.opsInsight.findFirstOrThrow()).status).toBe('OPEN');
  });

  it('cannot act on an insight the lane already resolved', async () => {
    const { service, insight } = await world();
    await upsertInsights(serviceScope(service.id), 'test.kind', [], { area: 'automation' });
    await expect(
      decideInsight(await actorFor('ADMIN'), { id: insight.id, decision: 'accept' })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('switches', () => {
  it('are off by default, saved with the revision check and audited', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    expect(await getIntelligenceSettings()).toMatchObject({
      opsInsightsEnabled: false,
      opsInsightsAutomationEnabled: false,
      opsInsightsNotificationsEnabled: false,
    });
    const saved = await updateOpsInsightSwitches({ ...ALL_ON, expectedRevision: 0 }, actor);
    expect(saved).toMatchObject({ opsInsightsEnabled: true, revision: 1 });
    await expect(
      updateOpsInsightSwitches({ ...ALL_ON, expectedRevision: 0 }, actor)
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await db.auditLog.count({ where: { action: 'intelligence.settings.updated' } })).toBe(1);

    // The general settings form does not carry the switches: saving it leaves them as they are.
    const { revision, ...current } = await getIntelligenceSettings();
    const general = Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith('opsInsights'))
    );
    const after = await updateIntelligenceSettings(
      { ...general, enabled: true, expectedRevision: revision },
      actor
    );
    expect(after).toMatchObject({
      enabled: true,
      opsInsightsEnabled: true,
      opsInsightsOnCallEnabled: true,
    });
  });
});

describe('retention', () => {
  it('removes old decided or resolved insights and those whose scope is gone, in bounded batches', async () => {
    const service = await createTestService('Svc');
    const scope = serviceScope(service.id);
    await upsertInsights(scope, 'test.kind', [item('open'), item('old')], { area: 'automation' });
    await upsertInsights(scope, 'test.kind', [item('open')], { area: 'automation' });
    await upsertInsights(serviceScope('deleted-service'), 'test.kind', [item('orphan')], {
      area: 'automation',
    });
    await db.opsInsightScopeState.create({
      data: {
        scopeType: 'SERVICE',
        scopeId: 'deleted-service',
        inputHash: 'x',
        computedAt: new Date(),
      },
    });
    // Not old enough yet: only the orphan goes.
    expect(await purgeOpsInsights(db, { cutoff: hoursAgo(24), limit: 100 })).toBe(1);
    expect(await db.opsInsightScopeState.count()).toBe(0);
    await db.$executeRaw`UPDATE "OpsInsight" SET "updatedAt" = now() - interval '400 days'`;
    expect(await purgeOpsInsights(db, { cutoff: hoursAgo(24 * 365), limit: 100 })).toBe(1);
    expect((await db.opsInsight.findMany()).map(row => row.key)).toEqual(['open']);
  });
});
