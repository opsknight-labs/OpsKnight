import { beforeEach, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion, getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { analyzeIncident } from '@/lib/intelligence/similarity/analyzer';
import { replaceFindings } from '@/lib/intelligence/similarity/findings';
import { readIncidentAnalysisState } from '@/lib/intelligence/analysis/view';
import { requestIncidentAnalysis } from '@/lib/intelligence/analysis/request';
import { enqueueWorkItems, WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fixture() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const actor = (await resolveUserActor(admin.id))!;
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  await publishPolicyVersion(
    {},
    {
      mode: 'SUGGEST',
      definition: {
        ...DEFAULT_POLICY_DEFINITION,
        response: { ...DEFAULT_POLICY_DEFINITION.response, enabled: false },
      },
      expectedHeadVersion: 0,
    },
    { actorId: admin.id, source: 'UI' }
  );
  const service = await createTestService('Analysis state source');
  const incident = await createTestIncident('A new incident', service.id);
  return { actor, incident };
}
async function analyze(incidentId: string, generation = 1) {
  await db.$transaction(tx => indexIncident(incidentId, tx));
  return analyzeIncident({ subjectKey: incidentId, generation }, await getIntelligenceSettings());
}
it('distinguishes waiting from completed analysis with no qualifying findings', async () => {
  const { actor, incident } = await fixture();
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({ status: 'WAITING' });
  expect(await analyze(incident.id)).toBe('analyzed');
  expect(await db.intelligenceFinding.count()).toBe(0);
  expect(
    await db.intelligenceAnalysisSnapshot.findUnique({
      where: { incidentId_kind: { incidentId: incident.id, kind: 'SIMILAR_INCIDENT' } },
    })
  ).toMatchObject({ rowCount: 0, generation: 1 });
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({
    status: 'CURRENT',
    lastSuccessfulAt: expect.any(String),
  });
});
it('labels source edits stale and never mistakes a stale fingerprint for fresh analysis', async () => {
  const { actor, incident } = await fixture();
  await analyze(incident.id);
  await db.incident.update({
    where: { id: incident.id },
    data: { title: 'Changed incident facts' },
  });
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({ status: 'STALE' });
  await analyzeIncident(
    { subjectKey: incident.id, generation: 2 },
    await getIntelligenceSettings()
  );
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({ status: 'STALE' });
  await analyze(incident.id, 3);
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({ status: 'CURRENT' });
});
it('fences an older result after a newer zero-result analysis', async () => {
  const { incident } = await fixture();
  const common = { incidentId: incident.id, kind: 'SIMILAR_INCIDENT' as const, policyVersion: 1 };
  const rows = [{ confidence: 0.9, subjectRef: 'older-match', evidence: {} }];
  await db.$transaction(tx => replaceFindings(tx, { ...common, generation: 10, rows }));
  await db.$transaction(tx => replaceFindings(tx, { ...common, generation: 11, rows: [] }));
  expect(
    await db.$transaction(tx => replaceFindings(tx, { ...common, generation: 10, rows }))
  ).toBe('stale');
  expect(await db.intelligenceFinding.count({ where: { status: 'ACTIVE' } })).toBe(0);
  expect(await db.intelligenceAnalysisSnapshot.findFirst()).toMatchObject({
    generation: 11,
    rowCount: 0,
  });
});
it('rolls back the success marker with its findings', async () => {
  const { incident } = await fixture();
  await expect(
    db.$transaction(async tx => {
      await replaceFindings(tx, {
        incidentId: incident.id,
        kind: 'SIMILAR_INCIDENT',
        generation: 1,
        policyVersion: 1,
        rows: [],
      });
      throw new Error('rollback fault');
    })
  ).rejects.toThrow('rollback fault');
  expect(await db.intelligenceAnalysisSnapshot.count()).toBe(0);
});
it('shows failed work without exposing its raw failure payload or automatically replaying it', async () => {
  const { actor, incident } = await fixture();
  await analyze(incident.id);
  await enqueueWorkItems([{ kind: WORK_KINDS.ANALYZE_INCIDENT, subjectKey: incident.id }]);
  await db.intelligenceWorkItem.updateMany({
    data: { attempts: 8, failedAt: new Date(), lastError: 'private-provider-error-canary-82' },
  });
  const state = await readIncidentAnalysisState(actor, incident.id);
  expect(state).toMatchObject({
    status: 'FAILED',
    canRefresh: false,
    diagnosticsHref: '/settings/intelligence',
  });
  expect(JSON.stringify(state)).not.toContain('private-provider-error-canary-82');
  expect(await requestIncidentAnalysis(actor, incident.id)).toBe('review_required');
  expect((await db.intelligenceWorkItem.findFirst())?.attempts).toBe(8);
});
it('shows paging backpressure as paused only while analysis work is outstanding', async () => {
  const { actor, incident } = await fixture();
  await analyze(incident.id);
  await db.backgroundJob.create({
    data: {
      type: 'ESCALATION',
      status: 'PENDING',
      scheduledAt: new Date(Date.now() - 60_000),
      payload: { incidentId: incident.id },
    },
  });
  expect((await readIncidentAnalysisState(actor, incident.id))?.status).toBe('CURRENT');
  await enqueueWorkItems([{ kind: WORK_KINDS.ANALYZE_INCIDENT, subjectKey: incident.id }]);
  expect((await readIncidentAnalysisState(actor, incident.id))?.status).toBe('PAUSED');
});
it('checks scope and operator permission before status and refresh operations', async () => {
  const { actor, incident } = await fixture();
  const user = await createTestUser({ role: 'USER' });
  const member = (await resolveUserActor(user.id))!;
  expect(await readIncidentAnalysisState(member, incident.id)).toBeNull();
  expect(await requestIncidentAnalysis(member, incident.id)).toBe('unavailable');
  expect(await requestIncidentAnalysis(actor, incident.id)).toBe('requested');
  expect(await db.intelligenceWorkItem.findFirst()).toMatchObject({
    kind: 'INDEX_INCIDENT',
    subjectKey: incident.id,
  });
  expect(
    await db.auditLog.findFirst({ where: { action: 'intelligence.analysis.requested' } })
  ).not.toBeNull();
});

it('detects a same-numbered service policy override and keeps OFF and SHADOW distinct', async () => {
  const { actor, incident } = await fixture();
  await analyze(incident.id);
  await publishPolicyVersion(
    { serviceId: incident.serviceId },
    {
      mode: 'SUGGEST',
      definition: {
        ...DEFAULT_POLICY_DEFINITION,
        response: { ...DEFAULT_POLICY_DEFINITION.response, enabled: false },
      },
      expectedHeadVersion: 0,
    },
    { actorId: actor.id, source: 'UI' }
  );
  expect((await readIncidentAnalysisState(actor, incident.id))?.status).toBe('STALE');
  await analyze(incident.id, 2);
  expect((await readIncidentAnalysisState(actor, incident.id))?.status).toBe('CURRENT');
  await publishPolicyVersion(
    { serviceId: incident.serviceId },
    { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 1 },
    { actorId: actor.id, source: 'UI' }
  );
  expect((await readIncidentAnalysisState(actor, incident.id))?.status).toBe('SHADOW');
  await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
  expect((await readIncidentAnalysisState(actor, incident.id))?.status).toBe('OFF');
  expect(await requestIncidentAnalysis(actor, incident.id)).toBe('off');
  expect(await db.intelligenceWorkItem.count()).toBe(0);
});

it('retains the newest empty generation under concurrent older writes', async () => {
  const { incident } = await fixture();
  const common = { incidentId: incident.id, kind: 'SIMILAR_INCIDENT' as const, policyVersion: 1 };
  await Promise.all([
    db.$transaction(tx => replaceFindings(tx, { ...common, generation: 20, rows: [] })),
    db.$transaction(tx =>
      replaceFindings(tx, {
        ...common,
        generation: 19,
        rows: [{ confidence: 0.9, subjectRef: 'late-match', evidence: {} }],
      })
    ),
  ]);
  expect(await db.intelligenceFinding.count({ where: { status: 'ACTIVE' } })).toBe(0);
  expect(await db.intelligenceAnalysisSnapshot.findFirst()).toMatchObject({
    generation: 20,
    rowCount: 0,
  });
});

it('expires success markers in bounded batches and cascades them with deleted incidents', async () => {
  const { incident } = await fixture();
  await analyze(incident.id);
  const { purgeExpiredIntelligenceData } = await import('@/lib/intelligence/jobs/retention');
  const settings = { ...(await getIntelligenceSettings()), findingRetentionDays: 1 };
  await db.intelligenceAnalysisSnapshot.updateMany({
    data: { completedAt: new Date(Date.now() - 2 * 86_400_000) },
  });
  expect(await purgeExpiredIntelligenceData(settings, { batchSize: 1 })).toMatchObject({
    analysisSnapshots: 1,
    more: true,
  });
  expect(await db.intelligenceAnalysisSnapshot.count()).toBe(0);
  await analyze(incident.id, 2);
  await db.incident.delete({ where: { id: incident.id } });
  expect(await db.intelligenceAnalysisSnapshot.count()).toBe(0);
});

it('labels legacy indexed data unverified without implying whether hidden matches exist', async () => {
  const { actor, incident } = await fixture();
  await db.$transaction(tx => indexIncident(incident.id, tx));
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({
    status: 'STALE',
    message: expect.stringContaining('No complete freshness record'),
  });
  expect((await readIncidentAnalysisState(actor, incident.id))?.lastSuccessfulAt).toBeUndefined();
});

it('hides retained similarity results when that recommendation feature is disabled', async () => {
  const { actor, incident } = await fixture();
  const previous = await createTestIncident('A previous related incident', incident.serviceId);
  await db.$transaction(tx =>
    replaceFindings(tx, {
      incidentId: incident.id,
      kind: 'SIMILAR_INCIDENT',
      generation: 1,
      policyVersion: 1,
      rows: [{ subjectRef: previous.id, confidence: 0.9, evidence: {} }],
    })
  );
  const { getSimilarIncidentsForActor } = await import('@/lib/intelligence/similarity/view');
  expect(await getSimilarIncidentsForActor(incident.id, actor)).toHaveLength(1);
  await publishPolicyVersion(
    {},
    {
      mode: 'SUGGEST',
      definition: {
        ...DEFAULT_POLICY_DEFINITION,
        similarity: { ...DEFAULT_POLICY_DEFINITION.similarity, enabled: false },
        response: { ...DEFAULT_POLICY_DEFINITION.response, enabled: false },
      },
      expectedHeadVersion: 1,
    },
    { actorId: actor.id, source: 'UI' }
  );
  expect(await getSimilarIncidentsForActor(incident.id, actor)).toBeNull();
  expect(await readIncidentAnalysisState(actor, incident.id)).toMatchObject({
    status: 'CURRENT',
    message: expect.stringContaining('features are disabled'),
  });
});
