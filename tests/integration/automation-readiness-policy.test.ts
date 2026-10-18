import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { GET as getCandidateRoute } from '@/app/api/v2/services/[id]/automation/candidate/route';
import { POST as activateCandidateRoute } from '@/app/api/v2/services/[id]/automation/candidates/activate/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { beforeEach, expect, it } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestUser,
} from '../helpers/test-db';
import { compileAutomation } from '@/lib/automation/compiler';
import { emptySnapshot } from '@/lib/automation/contract';
import { checksum } from '@/lib/automation/cache';
import { activateCandidate, AutomationConflict } from '@/lib/automation/versioning';
import { readAutomationReadiness } from '@/lib/automation/readiness';
import { updateAutomationSettings } from '@/lib/automation/settings-command';
import { DEFAULT_AUTOMATION_READINESS_POLICY } from '@/lib/automation/readiness-policy';
import { prepareAutomation } from '@/lib/automation/runtime';

beforeEach(async () => {
  await resetDatabase();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
});
// Qualification tests seed explicit evidence quantities. The separate worker-backed
// comparison/browser suites certify how those aggregates are produced.
async function fixture(evaluated = 100, ageDays = 0, failures = 0) {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Readiness policy');
  const { compiled } = compileAutomation(emptySnapshot);
  const versions = [];
  for (const versionNumber of [1, 2])
    versions.push(
      await db.automationVersion.create({
        data: {
          serviceId: service.id,
          versionNumber,
          snapshot: emptySnapshot,
          compiledSnapshot: compiled,
          checksum: checksum(compiled),
          publishedBy: actor.id,
          lintReport: [],
        },
      })
    );
  const [active, candidate] = versions;
  await db.serviceAutomationConfig.create({
    data: {
      serviceId: service.id,
      mode: 'LIVE',
      activeVersionId: active.id,
      candidateVersionId: candidate.id,
    },
  });
  const day = new Date(new Date(Date.now() - ageDays * 86400000).toISOString().slice(0, 10));
  await db.automationShadowAggregate.create({
    data: {
      serviceId: service.id,
      versionId: candidate.id,
      bucketDate: day,
      evaluated,
      same: evaluated - failures,
      errors: failures,
      fallbacks: failures,
    },
  });
  const activate = (
    acknowledgeNoShadow = false,
    acknowledgeShadowErrors = false,
    expectedReadinessPolicyRevision?: number
  ) =>
    activateCandidate({
      serviceId: service.id,
      actorId: actor.id,
      expectedCandidateVersionId: candidate.id,
      expectedActiveVersionId: active.id,
      acknowledgeNoShadow,
      acknowledgeShadowErrors,
      expectedReadinessPolicyRevision,
    });
  return { actor, service, active, candidate, activate };
}
it('uses the default quantity floor and records a deliberate insufficient-evidence exception', async () => {
  const f = await fixture(99);
  await expect(f.activate()).rejects.toThrow('insufficient recent Shadow evidence');
  await f.activate(true);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'automation.candidate.activated', entityId: f.service.id },
  });
  expect(audit.details).toMatchObject({
    newValue: {
      acknowledgeNoShadow: true,
      reviewedEvidence: {
        evaluated: 99,
        sufficientRecentEvidence: false,
        policy: DEFAULT_AUTOMATION_READINESS_POLICY,
      },
    },
  });
});
it('requires a separate freshness exception for stale daily evidence', async () => {
  const f = await fixture(100, 3);
  const readiness = await readAutomationReadiness(db, f.service.id, f.candidate.id);
  expect(readiness.evidenceAgeHours).toBeGreaterThan(48);
  await expect(f.activate()).rejects.toThrow('insufficient recent Shadow evidence');
  await expect(f.activate(true)).resolves.toMatchObject({ activeVersionId: f.candidate.id });
});
it('blocks pending and claimed candidate work even when quantity/error exceptions are accepted', async () => {
  const f = await fixture();
  await db.backgroundJob.create({
    data: {
      id: 'pending-candidate-readiness',
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      scheduledAt: new Date(),
      payload: {
        task: 'AUTOMATION_OBSERVE',
        serviceId: f.service.id,
        shadow: { versionId: f.candidate.id },
      },
    },
  });
  const before = await db.serviceAutomationConfig.findUniqueOrThrow({
    where: { serviceId: f.service.id },
  });
  await expect(f.activate(true, true)).rejects.toThrow('observation backlog exceeds');
  expect(
    await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: f.service.id } })
  ).toEqual(before);
  expect(await db.auditLog.count({ where: { action: 'automation.candidate.activated' } })).toBe(0);
  await db.backgroundJob.update({
    where: { id: 'pending-candidate-readiness' },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  await expect(f.activate()).resolves.toMatchObject({ activeVersionId: f.candidate.id });
});
it('uses the configured error rate without summing overlapping error and fallback counters', async () => {
  const f = await fixture(100, 0, 20);
  const settings = await updateAutomationSettings(
    {
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: 0,
      automationReadinessPolicy: { ...DEFAULT_AUTOMATION_READINESS_POLICY, maximumErrorRate: 0.1 },
    },
    { source: 'UI', actorId: f.actor.id }
  );
  const readiness = await readAutomationReadiness(db, f.service.id, f.candidate.id);
  expect(readiness.errorRate).toBe(0.2);
  await expect(f.activate(false, false, settings.automationSettingsRevision)).rejects.toThrow(
    'errors and fallbacks above'
  );
  await expect(f.activate(false, true, settings.automationSettingsRevision)).resolves.toMatchObject(
    { activeVersionId: f.candidate.id }
  );
});
it('fences a UI review against policy changes before activation', async () => {
  const f = await fixture();
  const review = await readAutomationReadiness(db, f.service.id, f.candidate.id);
  await updateAutomationSettings(
    {
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: 0,
      automationReadinessPolicy: {
        ...DEFAULT_AUTOMATION_READINESS_POLICY,
        minimumEvaluations: 200,
      },
    },
    { source: 'UI', actorId: f.actor.id }
  );
  await expect(f.activate(true, true, review.settingsRevision)).rejects.toBeInstanceOf(
    AutomationConflict
  );
  expect(
    (await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: f.service.id } }))
      .activeVersionId
  ).toBe(f.active.id);
});
it('fails activation closed on malformed stored policy without interrupting LIVE preparation', async () => {
  const f = await fixture();
  await db.systemSettings.update({
    where: { id: 'default' },
    data: { automationReadinessPolicy: { invalid: true } },
  });
  await expect(f.activate(true, true)).rejects.toThrow(
    'invalid global activation readiness policy'
  );
  const event = {
    event_action: 'trigger' as const,
    dedup_key: 'invalid-policy',
    payload: { summary: 'LIVE unaffected', source: 'test', severity: 'info' as const },
  };
  await expect(
    db.$transaction(tx =>
      prepareAutomation(
        tx,
        {
          serviceId: f.service.id,
          integrationId: 'fixture',
          integrationType: 'EVENTS_API',
          event,
          providerPayload: event,
          receivedAt: new Date(),
        },
        { priority: 'P3', urgency: 'LOW' }
      )
    )
  ).resolves.toMatchObject({ mode: 'LIVE', versionId: f.active.id });
});

it('advances the policy fence for database writers and excludes other-service backlog', async () => {
  const f = await fixture();
  const before = await readAutomationReadiness(db, f.service.id, f.candidate.id);
  await db.backgroundJob.create({
    data: {
      id: 'unrelated-readiness-job',
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: new Date(),
      payload: {
        task: 'AUTOMATION_OBSERVE',
        serviceId: 'other-service',
        shadow: { versionId: f.candidate.id },
      },
    },
  });
  expect(
    (await readAutomationReadiness(db, f.service.id, f.candidate.id)).backlogWithinPolicy
  ).toBe(true);
  await db.systemSettings.update({
    where: { id: 'default' },
    data: {
      automationReadinessPolicy: {
        ...DEFAULT_AUTOMATION_READINESS_POLICY,
        minimumEvaluations: 101,
      },
    },
  });
  const after = await readAutomationReadiness(db, f.service.id, f.candidate.id);
  expect(after.settingsRevision).toBe(before.settingsRevision + 1);
  await expect(f.activate(true, true, before.settingsRevision)).rejects.toBeInstanceOf(
    AutomationConflict
  );
});

it('exposes readiness through REST and rejects a stale reviewed policy before committing API audit/replay', async () => {
  const f = await fixture();
  const credential = await createV2Credential(['automation:read', 'automation:publish']);
  const params = { id: f.service.id },
    path = `/services/${f.service.id}/automation`;
  const candidate = await invokeV2(
    getCandidateRoute,
    credential.token,
    'GET',
    `${path}/candidate`,
    params
  );
  expect(candidate.status).toBe(200);
  const body = await candidate.json();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'readiness-spec', components: getOpenApiV2Spec().components });
  const validate = ajv.getSchema('readiness-spec#/components/schemas/AutomationCandidateVersion')!;
  expect(validate(body.data), JSON.stringify(validate.errors)).toBe(true);
  expect(body.data.readiness).toMatchObject({
    settingsRevision: 0,
    sufficientRecentEvidence: true,
    backlogWithinPolicy: true,
    errorsWithinPolicy: true,
  });
  await updateAutomationSettings(
    {
      automationEnabled: true,
      automationTraceRetentionDays: 90,
      expectedRevision: 0,
      automationReadinessPolicy: {
        ...DEFAULT_AUTOMATION_READINESS_POLICY,
        minimumEvaluations: 101,
      },
    },
    { source: 'UI', actorId: f.actor.id }
  );
  const key = crypto.randomUUID();
  const activate = (revision: number) =>
    invokeV2(
      activateCandidateRoute,
      credential.token,
      'POST',
      `${path}/candidates/activate`,
      params,
      {
        expectedCandidateVersionId: f.candidate.id,
        expectedActiveVersionId: f.active.id,
        acknowledgeNoShadow: true,
        expectedReadinessPolicyRevision: revision,
      },
      { 'Idempotency-Key': key }
    );
  expect((await activate(0)).status).toBe(412);
  expect(await db.auditLog.count({ where: { action: 'automation.candidate.activated' } })).toBe(0);
  expect((await activate(1)).status).toBe(200);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'automation.candidate.activated' },
  });
  expect(audit.details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: credential.key.id },
    newValue: { reviewedEvidence: { settingsRevision: 1, policy: { minimumEvaluations: 101 } } },
  });
});
it.each([
  { minimumEvaluations: 0 },
  { maximumPendingObservations: 1001 },
  { maximumEvidenceAgeHours: 12 },
  { maximumErrorRate: 1.01 },
])('rejects an out-of-bounds policy before changing state: %j', async invalid => {
  const actor = await createTestUser({ role: 'ADMIN' });
  await expect(
    updateAutomationSettings(
      {
        automationEnabled: true,
        automationTraceRetentionDays: 90,
        expectedRevision: 0,
        automationReadinessPolicy: { ...DEFAULT_AUTOMATION_READINESS_POLICY, ...invalid },
      },
      { source: 'UI', actorId: actor.id }
    )
  ).rejects.toThrow();
  expect(
    (await db.systemSettings.findUniqueOrThrow({ where: { id: 'default' } }))
      .automationSettingsRevision
  ).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'automation.settings.updated' } })).toBe(0);
});
