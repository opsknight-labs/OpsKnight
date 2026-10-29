import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { recordChange } from '@/lib/intelligence/changes/service';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { computeRunbookFindings } from '@/lib/intelligence/recommendations/ranker';
import {
  declareDependency,
  listDependencies,
  removeDependency,
  reviewDependency,
} from '@/lib/intelligence/dependencies/service';
import { suggestObservedDependencies } from '@/lib/intelligence/dependencies/observer';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { analyzeResponse, shouldAnalyzeResponse } from '@/lib/intelligence/response/handler';
import { getResponseIntelligenceForActor } from '@/lib/intelligence/response/view';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { getAlertQualityLeaderboard } from '@/lib/intelligence/triage/alert-quality';
import {
  createTestIncident,
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
});

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 };
const MIN = 60_000;
const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function setup(mode: 'OFF' | 'SHADOW' | 'SUGGEST', response = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    {
      mode,
      definition: { ...DEFAULT_POLICY_DEFINITION, response: { enabled: response } },
      expectedHeadVersion: 0,
    },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  return admin;
}

async function publishedRunbook(name: string) {
  const runbook = await db.runbook.create({
    data: { name, slug: `${name}-${Math.random().toString(36).slice(2, 8)}` },
  });
  const version = await db.runbookVersion.create({
    data: { runbookId: runbook.id, version: 1, state: 'PUBLISHED', definition: {}, checksum: 'x' },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
  return { runbook, version };
}

async function execution(
  runbook: { id: string },
  versionId: string,
  serviceId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
) {
  const startedAt = new Date(Date.now() - 10 * MIN);
  const completedAt = new Date(Date.now() - 5 * MIN);
  const incident = await createTestIncident('Previously fixed problem', serviceId, {
    createdAt: new Date(Date.now() - 20 * MIN),
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  await db.runbookExecution.create({
    data: {
      runbookId: runbook.id,
      runbookVersionId: versionId,
      serviceId,
      incidentId: incident.id,
      startedAt,
      completedAt,
      status,
      deadlineAt: new Date(Date.now() + 3_600_000),
      definitionChecksum: 'x',
    },
  });
}

describe('recording changes', () => {
  it('creates once per (source, dedupKey) and cleans operator text', async () => {
    const service = await createTestService('API');
    const input = {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY' as const,
      summary: '  api\u0007 v2   released\n',
      dedupKey: 'run-1',
      occurredAt: new Date(Date.now() - MIN),
    };
    const first = await recordChange(input);
    const second = await recordChange(input);
    expect(first.status).toBe('created');
    expect(second).toEqual({ status: 'duplicate', id: first.id });
    expect((await db.changeEvent.findUniqueOrThrow({ where: { id: first.id } })).summary).toBe(
      'api v2 released'
    );
    // Different source, same key is a different change.
    expect((await recordChange({ ...input, source: 'other' })).status).toBe('created');
    // No dedup key means no dedup.
    const loose = { ...input, dedupKey: undefined };
    expect((await recordChange(loose)).id).not.toBe((await recordChange(loose)).id);
  });

  it('accepts ISO strings, Unix seconds and Unix milliseconds for the time of the change', async () => {
    const service = await createTestService('API');
    const at = Date.now() - 5 * MIN;
    const base = {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY' as const,
      summary: 'release',
    };
    for (const [key, occurredAt] of [
      ['iso', new Date(at).toISOString()],
      ['seconds', Math.floor(at / 1000)],
      ['millis', at],
    ] as const) {
      const { id } = await recordChange({ ...base, dedupKey: key, occurredAt });
      const stored = await db.changeEvent.findUniqueOrThrow({ where: { id } });
      expect(Math.abs(stored.occurredAt.getTime() - at)).toBeLessThan(1_000);
    }
  });

  it('re-analyses incidents that opened after a change which arrived late', async () => {
    const service = await createTestService('API');
    const other = await createTestService('Other');
    const opened = await createTestIncident('Latency high', service.id, {
      createdAt: new Date(Date.now() - 10 * MIN),
    });
    const unrelated = await createTestIncident('Disk full', other.id, {
      createdAt: new Date(Date.now() - 10 * MIN),
    });
    const before = await createTestIncident('Earlier', service.id, {
      createdAt: new Date(Date.now() - 60 * MIN),
    });
    for (const incident of [opened, unrelated, before])
      await db.$transaction(tx => indexIncident(incident.id, tx));

    await recordChange({
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'v9',
      occurredAt: new Date(Date.now() - 20 * MIN),
    });
    const queued = await db.intelligenceWorkItem.findMany({ where: { kind: 'ANALYZE_RESPONSE' } });
    expect(queued.map(item => item.subjectKey)).toEqual([opened.id]);
  });

  it('rejects invalid, future, stale and unknown-service changes', async () => {
    const base = { source: 'ci', kind: 'DEPLOY' as const, summary: 'x', occurredAt: new Date() };
    await expect(recordChange({ ...base, summary: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(recordChange({ ...base, kind: 'NOPE' as never })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(recordChange({ ...base, url: 'javascript:alert(1)' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      recordChange({ ...base, occurredAt: new Date(Date.now() + 3_600_000) })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      recordChange({ ...base, occurredAt: new Date(Date.now() - 40 * 86_400_000) })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(recordChange({ ...base, serviceId: 'missing' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await db.changeEvent.count()).toBe(0);
  });
});

describe('dependencies', () => {
  it('declares, lists, reviews suggestions and removes, with audit', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    const web = await createTestService('Web');
    const api = await createTestService('API');
    const db1 = await createTestService('DB');

    await expect(
      declareDependency({ upstreamServiceId: web.id, downstreamServiceId: web.id }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      declareDependency({ upstreamServiceId: 'missing', downstreamServiceId: web.id }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const declared = await declareDependency(
      { upstreamServiceId: api.id, downstreamServiceId: web.id },
      actor
    );
    await declareDependency({ upstreamServiceId: api.id, downstreamServiceId: web.id }, actor);
    expect(await db.serviceDependency.count()).toBe(1);

    const suggested = await db.serviceDependency.create({
      data: {
        upstreamServiceId: db1.id,
        downstreamServiceId: api.id,
        origin: 'OBSERVED',
        status: 'SUGGESTED',
        confidence: 0.5,
        evidence: {},
      },
    });
    expect((await listDependencies()).map(d => d.status).sort()).toEqual(['ACTIVE', 'SUGGESTED']);
    expect(await reviewDependency(declared.id, 'APPROVE', actor)).toBe('not_found'); // only suggestions are reviewable
    expect(await reviewDependency(suggested.id, 'APPROVE', actor)).toBe('updated');
    expect(await reviewDependency(suggested.id, 'REJECT', actor)).toBe('not_found');
    expect(await removeDependency(suggested.id, actor)).toBe('removed');
    expect(await removeDependency(suggested.id, actor)).toBe('not_found');

    const actions = (await db.auditLog.findMany({ select: { action: true } })).map(
      row => row.action
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'intelligence.dependency.declared',
        'intelligence.dependency.approved',
        'intelligence.dependency.removed',
      ])
    );
  });

  it('rejects a self-dependency at the database level too', async () => {
    const service = await createTestService('Solo');
    await expect(
      db.serviceDependency.create({
        data: {
          upstreamServiceId: service.id,
          downstreamServiceId: service.id,
          origin: 'DECLARED',
          evidence: {},
        },
      })
    ).rejects.toThrow();
  });

  it('suggests observed edges only as SUGGESTED and never overrides a rejection', async () => {
    const a = await createTestService('Upstream');
    const b = await createTestService('Downstream');
    const base = Date.now() - 2 * 86_400_000;
    for (let i = 0; i < 6; i += 1) {
      const at = base + i * 3_600_000;
      await createTestIncident(`a ${i}`, a.id, { createdAt: new Date(at) });
      await createTestIncident(`b ${i}`, b.id, { createdAt: new Date(at + 2 * MIN) });
    }
    expect(await suggestObservedDependencies(settings)).toBe(1);
    const edge = await db.serviceDependency.findFirstOrThrow();
    expect(edge).toMatchObject({
      upstreamServiceId: a.id,
      downstreamServiceId: b.id,
      origin: 'OBSERVED',
      status: 'SUGGESTED',
    });
    expect(edge.confidence).toBeGreaterThan(0);
    expect(edge.confidence).toBeLessThanOrEqual(0.9);
    // Idempotent.
    expect(await suggestObservedDependencies(settings)).toBe(0);
    await db.serviceDependency.update({ where: { id: edge.id }, data: { status: 'REJECTED' } });
    expect(await suggestObservedDependencies(settings)).toBe(0);
    expect((await db.serviceDependency.findUniqueOrThrow({ where: { id: edge.id } })).status).toBe(
      'REJECTED'
    );
  });

  it('counts co-occurrences that straddle a time-bucket boundary', async () => {
    const a = await createTestService('Upstream');
    const b = await createTestService('Downstream');
    // Each upstream incident opens one minute before a ten-minute boundary, its follower two minutes later.
    const boundary = Math.floor((Date.now() - 86_400_000) / 600_000) * 600_000;
    for (let i = 0; i < 5; i += 1) {
      const at = boundary - i * 3_600_000 - MIN;
      await createTestIncident(`a ${i}`, a.id, { createdAt: new Date(at) });
      await createTestIncident(`b ${i}`, b.id, { createdAt: new Date(at + 2 * MIN) });
    }
    expect(await suggestObservedDependencies(settings)).toBe(1);
    expect(await db.serviceDependency.findFirstOrThrow()).toMatchObject({
      upstreamServiceId: a.id,
      downstreamServiceId: b.id,
    });
  });

  it('does not suggest from too few co-occurrences', async () => {
    const a = await createTestService('Upstream');
    const b = await createTestService('Downstream');
    for (let i = 0; i < 3; i += 1) {
      const at = Date.now() - (i + 1) * 3_600_000;
      await createTestIncident(`a ${i}`, a.id, { createdAt: new Date(at) });
      await createTestIncident(`b ${i}`, b.id, { createdAt: new Date(at + MIN) });
    }
    expect(await suggestObservedDependencies(settings)).toBe(0);
  });
});

describe('response analysis', () => {
  async function scenario() {
    const admin = await setup('SUGGEST');
    const web = await createTestService('Web');
    const api = await createTestService('API');
    const unrelated = await createTestService('Billing');
    await declareDependency(
      { upstreamServiceId: api.id, downstreamServiceId: web.id },
      { actorId: admin.id, source: 'UI' }
    );
    const onset = new Date(Date.now() - 5 * MIN);
    const at = (minutesBefore: number) => new Date(onset.getTime() - minutesBefore * MIN);
    const incident = await createTestIncident('Web 5xx spike', web.id, { createdAt: onset });
    const make = (
      serviceId: string | null,
      minutesBefore: number,
      summary: string,
      kind: 'DEPLOY' | 'CONFIG' = 'DEPLOY'
    ) =>
      db.changeEvent.create({
        data: { serviceId, source: 'ci', kind, summary, occurredAt: at(minutesBefore) },
      });
    const own = await make(web.id, 10, 'web deploy');
    const upstream = await make(api.id, 20, 'api deploy');
    const global = await make(null, 5, 'global config', 'CONFIG');
    await make(unrelated.id, 5, 'billing deploy');
    await make(web.id, 600, 'ancient web deploy');
    await db.changeEvent.create({
      data: {
        serviceId: web.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'after onset',
        occurredAt: new Date(onset.getTime() + MIN),
      },
    });
    const upstreamIncident = await createTestIncident('API latency', api.id, { createdAt: at(15) });
    await createTestIncident('Billing latency', unrelated.id, { createdAt: at(15) });
    return { admin, web, api, incident, own, upstream, global, upstreamIncident };
  }

  it('ranks nearby, related changes and upstream incidents; ignores unrelated, stale and later ones', async () => {
    const s = await scenario();
    expect(await analyzeResponse({ subjectKey: s.incident.id, generation: 1 }, settings)).toBe(
      'analyzed'
    );

    const changes = await db.intelligenceFinding.findMany({
      where: { incidentId: s.incident.id, kind: 'CHANGE_CORRELATION', status: 'ACTIVE' },
      orderBy: { rank: 'asc' },
    });
    expect(changes.map(f => f.subjectRef)).toEqual([s.own.id, s.upstream.id, s.global.id]);
    expect(changes[0].confidence).toBeGreaterThan(changes[1].confidence);
    expect(changes[0].evidence).toMatchObject({
      relation: 'SAME_SERVICE',
      depth: 0,
      calibrated: false,
    });
    expect(changes[1].evidence).toMatchObject({ relation: 'UPSTREAM', depth: 1 });
    // Evidence carries no free text.
    expect(JSON.stringify(changes.map(f => f.evidence))).not.toMatch(/deploy|config/);

    const causes = await db.intelligenceFinding.findMany({
      where: { incidentId: s.incident.id, kind: 'PROBABLE_CAUSE', status: 'ACTIVE' },
    });
    expect(causes.map(f => f.subjectRef)).toEqual([s.upstreamIncident.id]);
  });

  it('is idempotent, supersedes on re-analysis and drops stale generations', async () => {
    const s = await scenario();
    await analyzeResponse({ subjectKey: s.incident.id, generation: 2 }, settings);
    await analyzeResponse({ subjectKey: s.incident.id, generation: 3 }, settings);
    expect(
      await db.intelligenceFinding.count({
        where: { incidentId: s.incident.id, kind: 'CHANGE_CORRELATION', status: 'ACTIVE' },
      })
    ).toBe(3);
    expect(
      await db.intelligenceFinding.count({
        where: { incidentId: s.incident.id, kind: 'CHANGE_CORRELATION', status: 'SUPERSEDED' },
      })
    ).toBe(3);
    expect(await analyzeResponse({ subjectKey: s.incident.id, generation: 1 }, settings)).toBe(
      'stale'
    );
    expect(
      await db.intelligenceFinding.count({
        where: { incidentId: s.incident.id, kind: 'CHANGE_CORRELATION', status: 'ACTIVE' },
      })
    ).toBe(3);
  });

  it('ignores suggested and rejected dependency edges', async () => {
    const s = await scenario();
    await db.serviceDependency.updateMany({ data: { status: 'SUGGESTED' } });
    await analyzeResponse({ subjectKey: s.incident.id, generation: 1 }, settings);
    const refs = (
      await db.intelligenceFinding.findMany({
        where: { incidentId: s.incident.id, status: 'ACTIVE' },
      })
    ).map(f => f.subjectRef);
    expect(refs).not.toContain(s.upstream.id);
    expect(refs).not.toContain(s.upstreamIncident.id);
    expect(refs).toContain(s.own.id);
  });

  it('terminates with cyclic dependencies', async () => {
    const s = await scenario();
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: s.web.id,
        downstreamServiceId: s.api.id,
        origin: 'DECLARED',
        evidence: {},
      },
    });
    expect(await analyzeResponse({ subjectKey: s.incident.id, generation: 1 }, settings)).toBe(
      'analyzed'
    );
  });

  it('recommends runbooks by evidence, excluding unproven, unpublished and cancelled-only history', async () => {
    const s = await scenario();
    const proven = await publishedRunbook('proven');
    const lucky = await publishedRunbook('lucky');
    const bound = await publishedRunbook('bound-untried');
    const cancelledOnly = await publishedRunbook('cancelled-only');
    const draft = await db.runbook.create({
      data: { name: 'draft', slug: `draft-${Math.random().toString(36).slice(2, 8)}` },
    });
    for (let i = 0; i < 9; i += 1)
      await execution(proven.runbook, proven.version.id, s.web.id, 'SUCCEEDED');
    await execution(proven.runbook, proven.version.id, s.web.id, 'FAILED');
    await execution(lucky.runbook, lucky.version.id, s.web.id, 'SUCCEEDED');
    await execution(cancelledOnly.runbook, cancelledOnly.version.id, s.web.id, 'CANCELLED');
    await db.serviceAutomationRule.createMany({
      data: [
        { serviceId: s.web.id, runbookId: bound.runbook.id },
        { serviceId: s.web.id, runbookId: draft.id },
      ],
    });
    await analyzeResponse({ subjectKey: s.incident.id, generation: 1 }, settings);
    const found = await db.intelligenceFinding.findMany({
      where: { incidentId: s.incident.id, kind: 'RUNBOOK_RECOMMENDATION', status: 'ACTIVE' },
      orderBy: { rank: 'asc' },
    });
    expect(found.map(f => f.subjectRef)).toEqual([
      proven.runbook.id,
      lucky.runbook.id,
      bound.runbook.id,
    ]);
    expect(found[0].evidence).toMatchObject({ succeeded: 9, eligible: 10, bound: false });
    expect(found[2].evidence).toMatchObject({ succeeded: 0, eligible: 0, bound: true });
  });

  it('credits resolved incidents only within the run outcome window, with separate same-problem evidence', async () => {
    const service = await createTestService('API');
    const target = await createTestIncident('Postgres replica lag', service.id);
    await db.$transaction(tx => indexIncident(target.id, tx));
    const { runbook, version } = await publishedRunbook('restart-replica');
    await db.serviceAutomationRule.create({
      data: { serviceId: service.id, runbookId: runbook.id },
    });
    const now = new Date();
    const startedAt = new Date(now.getTime() - 180 * MIN);
    const completedAt = new Date(now.getTime() - 170 * MIN);
    // A fix during the run or shortly after it is useful evidence. A prior resolution, a late
    // resolution, an open/reopened incident and a standalone script are not.
    for (const [title, status, resolvedAt] of [
      ['Postgres replica lag', 'RESOLVED', new Date(completedAt.getTime() + 10 * MIN)],
      ['Different problem', 'RESOLVED', new Date(startedAt.getTime() + MIN)],
      ['Postgres replica lag', 'RESOLVED', new Date(startedAt.getTime() - MIN)],
      ['Postgres replica lag', 'RESOLVED', new Date(completedAt.getTime() + 121 * MIN)],
      ['Postgres replica lag', 'OPEN', null],
      ['Postgres replica lag', 'OPEN', new Date(completedAt.getTime() + MIN)],
    ] as const) {
      const incident = await createTestIncident(title, service.id, {
        status,
        resolvedAt,
        createdAt: new Date(startedAt.getTime() - MIN),
      });
      await db.$transaction(tx => indexIncident(incident.id, tx));
      await db.runbookExecution.create({
        data: {
          runbookId: runbook.id,
          runbookVersionId: version.id,
          serviceId: service.id,
          incidentId: incident.id,
          status: 'SUCCEEDED',
          startedAt,
          completedAt,
          deadlineAt: now,
          definitionChecksum: 'x',
        },
      });
    }
    await db.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        serviceId: service.id,
        status: 'SUCCEEDED',
        startedAt,
        completedAt,
        deadlineAt: now,
        definitionChecksum: 'x',
      },
    });
    const findings = await db.$transaction(tx => computeRunbookFindings(tx, target, now));
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toMatchObject({
      succeeded: 2,
      eligible: 7,
      sameProblem: { succeeded: 1, eligible: 5 },
    });
  });

  it('does nothing when the policy is OFF or response analysis is disabled', async () => {
    const off = await setup('OFF');
    const service = await createTestService('Web');
    const incident = await createTestIncident('x', service.id);
    expect(await shouldAnalyzeResponse(incident.id)).toBe(false);
    expect(await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings)).toBe(
      'skipped_off'
    );
    expect(await db.intelligenceFinding.count()).toBe(0);
    await publishPolicyVersion(
      {},
      {
        mode: 'SUGGEST',
        definition: { ...DEFAULT_POLICY_DEFINITION, response: { enabled: false } },
        expectedHeadVersion: 1,
      },
      { actorId: off.id, source: 'UI' }
    );
    expect(await shouldAnalyzeResponse(incident.id)).toBe(false);
    expect(await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings)).toBe(
      'skipped_disabled_feature'
    );
    expect(await analyzeResponse({ subjectKey: 'missing', generation: 1 }, settings)).toBe(
      'incident_gone'
    );
  });

  it('old policy versions without a response block default to enabled', async () => {
    await setup('SUGGEST');
    const row = await db.intelligencePolicyVersion.findFirstOrThrow();
    const legacy = { ...(row.definition as Record<string, unknown>) };
    delete legacy.response;
    await db.$executeRaw`ALTER TABLE "IntelligencePolicyVersion" DISABLE TRIGGER USER`;
    await db.intelligencePolicyVersion.update({
      where: { id: row.id },
      data: { definition: legacy as never },
    });
    await db.$executeRaw`ALTER TABLE "IntelligencePolicyVersion" ENABLE TRIGGER USER`;
    const service = await createTestService('Web');
    const incident = await createTestIncident('x', service.id);
    expect(await shouldAnalyzeResponse(incident.id)).toBe(true);
  });
});

describe('response view', () => {
  it('shows findings in SUGGEST mode, nothing in SHADOW', async () => {
    const admin = await setup('SUGGEST');
    const web = await createTestService('Web');
    const incident = await createTestIncident('Web down', web.id, { createdAt: new Date() });
    await db.changeEvent.create({
      data: {
        serviceId: web.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'web v9',
        version: '9',
        occurredAt: new Date(Date.now() - 10 * MIN),
      },
    });
    const { runbook, version } = await publishedRunbook('restart');
    await execution(runbook, version.id, web.id, 'SUCCEEDED');
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);

    const view = await getResponseIntelligenceForActor(incident.id, await actorOf(admin.id));
    expect(view!.changes).toHaveLength(1);
    expect(view!.changes[0]).toMatchObject({
      summary: 'web v9',
      relation: 'SAME_SERVICE',
      kind: 'DEPLOY',
    });
    expect(view!.changes[0].leadMinutes).toBeGreaterThanOrEqual(9);
    expect(view!.runbooks).toMatchObject([{ runbookId: runbook.id, succeeded: 1, eligible: 1 }]);

    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 1 },
      { actorId: admin.id, source: 'UI' }
    );
    expect(await getResponseIntelligenceForActor(incident.id, await actorOf(admin.id))).toBeNull();
  });

  it('never reveals changes, incidents or runbooks the viewer cannot read', async () => {
    const admin = await setup('SUGGEST');
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const web = await createTestService('Web', teamA.id);
    const secretApi = await createTestService('Secret API', teamB.id);
    await declareDependency(
      { upstreamServiceId: secretApi.id, downstreamServiceId: web.id },
      { actorId: admin.id, source: 'UI' }
    );
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });

    const onset = new Date();
    const incident = await createTestIncident('Web down', web.id, {
      createdAt: onset,
      teamId: teamA.id,
    });
    await createTestIncident('Secret API customer outage', secretApi.id, {
      createdAt: new Date(onset.getTime() - 10 * MIN),
      teamId: teamB.id,
    });
    await db.changeEvent.create({
      data: {
        serviceId: secretApi.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'secret deploy',
        occurredAt: new Date(onset.getTime() - 5 * MIN),
      },
    });
    await db.changeEvent.create({
      data: {
        serviceId: web.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'own deploy',
        occurredAt: new Date(onset.getTime() - 5 * MIN),
      },
    });
    const hiddenRunbook = await publishedRunbook('secret-runbook');
    await db.serviceAutomationRule.create({
      data: { serviceId: secretApi.id, runbookId: hiddenRunbook.runbook.id },
    });
    await execution(hiddenRunbook.runbook, hiddenRunbook.version.id, web.id, 'SUCCEEDED');
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);

    const adminView = await getResponseIntelligenceForActor(incident.id, await actorOf(admin.id));
    expect(adminView!.changes.map(c => c.summary).sort()).toEqual(['own deploy', 'secret deploy']);
    expect(adminView!.upstreamIncidents).toHaveLength(1);
    expect(adminView!.runbooks).toHaveLength(1);

    const memberView = await getResponseIntelligenceForActor(incident.id, await actorOf(member.id));
    expect(memberView!.changes.map(c => c.summary)).toEqual(['own deploy']);
    expect(memberView!.upstreamIncidents).toEqual([]);
    expect(memberView!.runbooks).toEqual([]);
    expect(JSON.stringify(memberView)).not.toMatch(/secret/i);
  });

  it('returns nothing for an incident the viewer cannot read', async () => {
    await setup('SUGGEST');
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const service = await createTestService('Other', teamB.id);
    const incident = await createTestIncident('x', service.id, { teamId: teamB.id });
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);
    expect(await getResponseIntelligenceForActor(incident.id, await actorOf(member.id))).toBeNull();
  });
});

describe('retention and alert quality', () => {
  it('purges change events past the finding retention', async () => {
    const service = await createTestService('Web');
    const old = new Date(Date.now() - 400 * 86_400_000);
    await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'old',
        occurredAt: old,
      },
    });
    await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'new',
        occurredAt: new Date(),
      },
    });
    const result = await purgeExpiredIntelligenceData(settings, { batchSize: 100 });
    expect(result.changeEvents).toBe(1);
    expect((await db.changeEvent.findMany()).map(c => c.summary)).toEqual(['new']);
  });

  it('flags services whose incidents clear instantly or are never acknowledged, for visible services only', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const noisy = await createTestService('Noisy');
    const healthy = await createTestService('Healthy');
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) {
      const created = new Date(now - (i + 1) * 3_600_000);
      await createTestIncident(`n${i}`, noisy.id, {
        createdAt: created,
        status: 'RESOLVED',
        resolvedAt: new Date(created.getTime() + MIN),
      });
      await createTestIncident(`h${i}`, healthy.id, {
        createdAt: created,
        status: 'RESOLVED',
        acknowledgedAt: new Date(created.getTime() + 2 * MIN),
        resolvedAt: new Date(created.getTime() + 90 * MIN),
      });
    }
    const board = await getAlertQualityLeaderboard(await actorOf(admin.id));
    expect(board.map(r => r.serviceId)).toEqual([noisy.id, healthy.id]);
    expect(board[0]).toMatchObject({
      flagged: true,
      quickResolvedRatio: 1,
      neverAcknowledgedRatio: 1,
    });
    expect(board[1]).toMatchObject({ flagged: false, noiseScore: 0 });

    const teamA = await createTestTeam('Team A');
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
    expect(await getAlertQualityLeaderboard(await actorOf(member.id))).toEqual([]);
  });
});
