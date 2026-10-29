import { beforeEach, describe, expect, it } from 'vitest';
import {
  INTELLIGENCE_SETTINGS_DEFAULTS,
  DEFAULT_POLICY_DEFINITION,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { correlateIncident } from '@/lib/intelligence/correlation/handler';
import { declareDependency } from '@/lib/intelligence/dependencies/service';
import { recordChange } from '@/lib/intelligence/changes/service';
import { analyzeResponse } from '@/lib/intelligence/response/handler';
import { getInsights } from '@/lib/intelligence/insights/service';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  adoptScoringWeights,
  suggestScoringWeights,
} from '@/lib/intelligence/learning/weights-service';
import {
  resetDatabase,
  testPrisma as db,
  createTestIncident,
  createTestService,
  createTestUser,
} from '../../helpers/test-db';

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 };
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

describe('outcome patterns', () => {
  it('counts once across replay/concurrency and adjusts for reopen, retitle and suppression', async () => {
    const service = await createTestService('API');
    const incident = await createTestIncident('Postgres replica lag', service.id, {
      createdAt: new Date(Date.now() - 3_600_000),
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });
    await db.postmortem.create({
      data: {
        incidentId: incident.id,
        title: 'Recovered',
        resolution: 'Restarted the replica; password=secret123456',
      },
    });
    await Promise.all([1, 2].map(() => db.$transaction(tx => indexIncident(incident.id, tx))));
    let pattern = await db.intelligencePattern.findFirstOrThrow({
      where: { kind: 'PROBLEM_OUTCOME' },
    });
    expect(pattern).toMatchObject({ support: 1, successes: 1, failures: 0 });
    expect(pattern.resolutionTotalMs).toBeGreaterThan(3_500_000);
    expect(
      (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } }))
        .resolutionSummary
    ).not.toContain('secret123456');
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'OPEN', resolvedAt: null },
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    pattern = await db.intelligencePattern.findFirstOrThrow();
    expect(pattern).toMatchObject({ support: 1, successes: 0, failures: 1, resolutionTotalMs: 0 });
    await db.incident.update({ where: { id: incident.id }, data: { title: 'Disk full' } });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    expect(await db.intelligencePattern.count()).toBe(1);
    expect((await db.intelligencePattern.findFirstOrThrow()).key).not.toBe(pattern.key);
    await db.$transaction(tx => indexIncident(incident.id, tx, { suppressed: true }));
    expect(await db.intelligencePattern.count()).toBe(0);
    expect(
      (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } }))
        .resolutionSummary
    ).toBeNull();
  });
});

describe('topology grouping', () => {
  it('crosses active dependencies only and enforces the configured content score', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    await db.intelligenceSettings.create({
      data: { ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    const a = await createTestService('Database');
    const b = await createTestService('API');
    const other = await createTestService('Unrelated');
    await declareDependency({ upstreamServiceId: a.id, downstreamServiceId: b.id }, actor);
    const at = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const incidents = [];
    for (const [service, title] of [
      [a, 'Database connection errors'],
      [b, 'Database connection timeout'],
      [other, 'Database connection errors'],
    ] as const) {
      const incident = await createTestIncident(title, service.id, {
        urgency: 'LOW',
        createdAt: new Date(at + 1000),
      });
      await db.alert.create({
        data: { incidentId: incident.id, serviceId: service.id, payload: { cluster: 'prod' } },
      });
      await db.$transaction(tx => indexIncident(incident.id, tx));
      incidents.push(incident);
    }
    const definition = (minScore: number) => ({
      ...DEFAULT_POLICY_DEFINITION,
      correlation: {
        criticalBypass: true,
        rules: [
          {
            id: 'dependency',
            kind: 'TOPOLOGY',
            enabled: true,
            keys: ['cluster'],
            windowSeconds: 3600,
            maxWindowSeconds: 3600,
            minScore,
          },
        ],
      },
    });
    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: definition(0.99), expectedHeadVersion: 0 },
      actor
    );
    for (const incident of incidents)
      await correlateIncident({ subjectKey: incident.id }, settings);
    expect(await db.correlationMember.count()).toBe(1);
    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: definition(0.1), expectedHeadVersion: 1 },
      actor
    );
    for (const incident of incidents)
      await correlateIncident({ subjectKey: incident.id }, settings);
    expect(await db.correlationMember.count({ where: { policyVersion: 2 } })).toBe(2);
    const group = await db.correlationGroup.findFirstOrThrow({ where: { policyVersion: 2 } });
    expect(group.scopeKind).toBe('TOPOLOGY');
  });
});

describe('change quality', () => {
  it('compares sanitized component labels and exposes actual flapping episodes', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    await db.intelligenceSettings.create({
      data: { ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      actor
    );
    const service = await createTestService('Checkout');
    const onset = Date.now() - 30_000;
    const incident = await createTestIncident('High latency', service.id, {
      createdAt: new Date(onset),
    });
    await db.alert.create({
      data: { incidentId: incident.id, serviceId: service.id, payload: { component: 'checkout' } },
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    const at = new Date(onset - 60_000);
    const matched = await recordChange({
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'checkout',
      component: 'checkout',
      labels: { api_token: 'do-not-store-this' },
      occurredAt: at,
    });
    const other = await recordChange({
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'other',
      component: 'warehouse',
      occurredAt: at,
    });
    expect((await db.changeEvent.findUniqueOrThrow({ where: { id: matched.id } })).labels).toEqual(
      {}
    );
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);
    const findings = await db.intelligenceFinding.findMany({
      where: { incidentId: incident.id, kind: 'CHANGE_CORRELATION' },
      orderBy: { rank: 'asc' },
    });
    expect(findings.map(f => f.subjectRef)).toEqual([matched.id, other.id]);
    for (let i = 0; i < 4; i++)
      await createTestIncident('Flapping check', service.id, {
        dedupKey: 'same-check',
        status: 'RESOLVED',
        createdAt: new Date(onset - (30 - 5 * i) * 60_000),
        resolvedAt: new Date(onset - (29 - 5 * i) * 60_000),
      });
    const view = await getInsights((await resolveUserActor(admin.id))!);
    expect(view?.flapping).toMatchObject([{ serviceId: service.id, episodes: 4 }]);
  });

  it('discounts prolific sources and queues downstream incidents for late changes', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    await db.intelligenceSettings.create({
      data: { ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      actor
    );
    const upstream = await createTestService('DB');
    const api = await createTestService('API');
    await declareDependency({ upstreamServiceId: upstream.id, downstreamServiceId: api.id }, actor);
    const onset = Date.now() - 60_000;
    const incident = await createTestIncident('Database errors', api.id, {
      createdAt: new Date(onset),
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    await db.changeEvent.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        serviceId: api.id,
        source: 'noisy',
        kind: 'CONFIG' as const,
        summary: 'routine',
        occurredAt: new Date(onset - (7 + i / 2) * 3_600_000),
      })),
    });
    const noisy = await recordChange({
      serviceId: api.id,
      source: 'noisy',
      kind: 'DEPLOY',
      summary: 'routine',
      occurredAt: new Date(onset - 60_000),
    });
    const quiet = await recordChange({
      serviceId: api.id,
      source: 'rare',
      kind: 'DEPLOY',
      summary: 'schema migration',
      occurredAt: new Date(onset - 30 * 60_000),
    });
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);
    const findings = await db.intelligenceFinding.findMany({
      where: { incidentId: incident.id, kind: 'CHANGE_CORRELATION' },
      orderBy: { rank: 'asc' },
    });
    expect(findings.map(f => f.subjectRef)).toEqual([quiet.id, noisy.id]);
    await db.intelligenceWorkItem.deleteMany({});
    await recordChange({
      serviceId: upstream.id,
      source: 'db-ci',
      kind: 'DEPLOY',
      summary: 'late deploy event',
      occurredAt: new Date(onset - 120_000),
    });
    expect(
      await db.intelligenceWorkItem.findFirst({
        where: { kind: 'ANALYZE_RESPONSE', subjectKey: incident.id },
      })
    ).not.toBeNull();
  });
});

describe('scoring policy proposals', () => {
  it('is read-only until an administrator publishes, then audits a revision-locked policy version', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      actor
    );
    const service = await createTestService('API');
    const source = await createTestIncident('subject', service.id);
    for (let i = 0; i < 100; i++) {
      const helpful = i % 2 === 1;
      const finding = await db.intelligenceFinding.create({
        data: {
          incidentId: source.id,
          subjectRef: `precedent-${i}`,
          kind: 'SIMILAR_INCIDENT',
          confidence: helpful ? 0.9 : 0.3,
          generation: 1,
          engineVersion: 'eval',
          evidence: {
            components: {
              tokens: helpful ? 0.9 : 0.3,
              template: helpful ? 0.9 : 0.3,
              labels: helpful ? 1 : 0,
              sameService: 1,
              recency: 1,
              resolved: 1,
            },
          },
        },
      });
      await db.intelligenceFeedback.create({
        data: {
          subjectType: 'FINDING',
          subjectId: finding.id,
          verdict: helpful ? 'HELPFUL' : 'NOT_HELPFUL',
          actorId: admin.id,
        },
      });
    }
    const suggestion = await suggestScoringWeights();
    expect(suggestion).not.toBeNull();
    expect((await resolveEffectivePolicy(null)).definition.similarity.weights).toBeUndefined();
    const published = await adoptScoringWeights(
      { suggestionId: suggestion!.id, expectedHeadVersion: 1 },
      actor
    );
    expect(published.version).toBe(2);
    expect((await resolveEffectivePolicy(null)).definition.similarity.weights).toEqual(
      suggestion!.weights
    );
    expect(await db.auditLog.count({ where: { action: 'intelligence.policy.published' } })).toBe(2);
    await expect(
      adoptScoringWeights({ suggestionId: suggestion!.id, expectedHeadVersion: 1 }, actor)
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
