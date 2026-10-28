import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTestService,
  createTestUser,
  linkServiceToStatusPage,
  testPrisma as db,
} from '../helpers/test-db';
import {
  describeSensitiveReads,
  principal,
  setupMcpReadDatabase,
  type ReadScenario,
} from '../helpers/mcp-read-scenarios';
import { compileAutomation } from '@/lib/automation/compiler';
import { emptySnapshot } from '@/lib/automation/contract';
import { checksum } from '@/lib/automation/cache';
import { createServiceBinding } from '@/lib/runbooks/bindings';
import {
  cloneVersionToDraft,
  createRunbook,
  publishDraftVersion,
} from '@/lib/runbooks/versioning';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';

setupMcpReadDatabase();

type Owner = { id: string };
const suffix = () => randomBytes(4).toString('hex');
const DRAFT_MARKER = `draft-confidential-${randomUUID()}`;

// --- Integrations -----------------------------------------------------------

/** An integration whose stored credentials are distinctive so any leak is detectable. */
async function integrationFixture() {
  const service = await createTestService('Sensitive read integration');
  const secrets = {
    key: `intkey-${randomUUID()}`,
    keyFingerprint: `fp-${randomUUID()}`,
    signatureSecret: `sigsecret-${randomUUID()}`,
    previousKey: `prevkey-${randomUUID()}`,
    previousKeyFingerprint: `prevfp-${randomUUID()}`,
    previousSignatureSecret: `prevsig-${randomUUID()}`,
  };
  const integration = await db.integration.create({
    data: {
      name: 'Sensitive read integration',
      serviceId: service.id,
      ...secrets,
      previousKeyExpiresAt: new Date(Date.now() + 600000),
      previousSignatureSecretExpiresAt: new Date(Date.now() + 600000),
    },
  });
  return { serviceId: service.id, integrationId: integration.id, secrets };
}

// --- Runbooks ---------------------------------------------------------------

const definition = (name = 'Review') => ({
  steps: [{ key: 'review', name, type: 'APPROVAL', config: { note: DRAFT_MARKER } }],
});
const slug = () => `sensitive-read-${randomUUID().slice(0, 8)}`;

async function draftRunbook(owner: Owner) {
  const book = await createRunbook(
    { name: 'Sensitive read runbook', slug: slug(), description: '', definition: definition() },
    owner.id
  );
  return { runbookId: book.id, versionId: book.draftVersionId! };
}
async function publishedRunbook(owner: Owner) {
  const draft = await draftRunbook(owner);
  const version = await publishDraftVersion(draft.versionId, owner.id);
  return { runbookId: draft.runbookId, versionId: version.id };
}
/** A published base version and a newer draft cloned from it. */
async function versionPair(owner: Owner) {
  const base = await publishedRunbook(owner);
  const draft = await cloneVersionToDraft(base.versionId, owner.id);
  return { runbookId: base.runbookId, baseVersionId: base.versionId, versionId: draft.id };
}

/** A finished execution with one step, one attempt carrying evidence, and audit events. */
async function executionFixture(owner: Owner) {
  const run = await publishedRunbook(owner);
  const version = await db.runbookVersion.findUniqueOrThrow({ where: { id: run.versionId } });
  const execution = await db.runbookExecution.create({
    data: {
      runbookId: run.runbookId,
      runbookVersionId: version.id,
      definitionChecksum: version.checksum,
      status: 'SUCCEEDED',
      triggeredByUserId: owner.id,
      completedAt: new Date(),
      deadlineAt: new Date(Date.now() + 600000),
      steps: {
        create: {
          stepKey: 'review',
          sequence: 0,
          name: 'Review',
          type: 'APPROVAL',
          riskClass: 'READ_ONLY',
          config: {},
          status: 'SUCCEEDED',
          requiresApproval: true,
        },
      },
    },
    include: { steps: true },
  });
  await db.runbookStepAttempt.create({
    data: {
      executionStepId: execution.steps[0].id,
      attemptNumber: 1,
      status: 'SUCCEEDED',
      completedAt: new Date(),
      preState: { state: 'before' },
      postState: { state: 'after' },
    },
  });
  await db.auditLog.createMany({
    data: ['runbook.execution.started', 'runbook.execution.completed'].map(action => ({
      action,
      entityType: 'RUNBOOK_EXECUTION' as const,
      entityId: execution.id,
      actorId: owner.id,
    })),
  });
  return { executionId: execution.id };
}

// --- Schedules --------------------------------------------------------------

async function scheduleFixture() {
  const responder = await createTestUser({ role: 'USER' });
  const schedule = await db.onCallSchedule.create({ data: { name: `Sensitive ${suffix()}` } });
  await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      start: new Date('2026-01-05T00:00:00.000Z'),
      users: { create: [{ userId: responder.id, position: 1 }] },
    },
  });
  await db.onCallOverride.create({
    data: {
      scheduleId: schedule.id,
      userId: responder.id,
      start: new Date(Date.now() + 86400000),
      end: new Date(Date.now() + 2 * 86400000),
    },
  });
  return { scheduleId: schedule.id };
}

// --- Service objectives -----------------------------------------------------

async function objectiveFixture() {
  const service = await createTestService('Sensitive read objective');
  const lineageId = `so_${randomUUID()}`;
  await db.serviceObjective.create({
    data: {
      id: lineageId,
      lineageId,
      serviceId: service.id,
      name: 'Availability goal',
      metricType: 'UPTIME',
      target: 99.9,
      comparator: 'GREATER_THAN_OR_EQUAL',
      windowType: 'SEVEN_DAYS',
    },
  });
  const periodEnd = new Date();
  await db.serviceObjectiveSnapshot.create({
    data: {
      objectiveId: lineageId,
      periodStart: new Date(periodEnd.getTime() - 7 * 86400000),
      periodEnd,
      value: 99.95,
      target: 99.9,
      breached: false,
      dataState: 'AVAILABLE',
      definitionVersion: 1,
    },
  });
  return { serviceId: service.id, lineageId };
}
/** A pending evaluation job requested by the owner (administrators may read any job). */
async function evaluationFixture(owner: Owner) {
  const objective = await objectiveFixture();
  const end = new Date();
  const job = await db.backgroundJob.create({
    data: {
      id: randomUUID(),
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: new Date(),
      maxAttempts: 3,
      payload: {
        task: 'SERVICE_OBJECTIVE_EVALUATE',
        lineageId: objective.lineageId,
        versionId: objective.lineageId,
        actorId: owner.id,
        apiClientId: `client-${suffix()}`,
        authorizationContext: 'a'.repeat(64),
        start: new Date(end.getTime() - 7 * 86400000).toISOString(),
        end: end.toISOString(),
      },
    },
  });
  return { ...objective, evaluationId: job.id };
}

// --- Service automation -----------------------------------------------------

function automationVersion(owner: Owner, serviceId: string, versionNumber: number) {
  const { compiled } = compileAutomation(emptySnapshot);
  return db.automationVersion.create({
    data: {
      serviceId,
      versionNumber,
      snapshot: emptySnapshot,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      publishedBy: owner.id,
      lintReport: [],
    },
  });
}
async function candidateFixture(owner: Owner) {
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const service = await createTestService('Sensitive read candidate');
  const active = await automationVersion(owner, service.id, 1);
  const candidate = await automationVersion(owner, service.id, 2);
  await db.serviceAutomationConfig.create({
    data: {
      serviceId: service.id,
      mode: 'LIVE',
      activeVersionId: active.id,
      candidateVersionId: candidate.id,
    },
  });
  return { serviceId: service.id };
}
async function observationFixture() {
  const { serviceId, integrationId } = await integrationFixture();
  await db.automationContextObservation.create({
    data: {
      serviceId,
      integrationId,
      integrationType: 'EVENTS_API_V2',
      source: 'monitoring',
      fieldKey: 'region',
      sourcePath: 'payload.custom_details.region',
      fieldType: 'STRING',
      normalizedRawValueHash: 'c'.repeat(64),
      rawValuePreview: 'eu-west-1',
      unmapped: true,
    },
  });
  return { serviceId };
}

/** A runbook rule with a recorded policy check against an Agent. */
async function policyCheckFixture(owner: Owner) {
  const service = await createTestService('Sensitive read rule');
  const runbook = await createRunbook(
    {
      name: 'Sensitive read rule runbook',
      slug: slug(),
      description: '',
      definition: {
        steps: [{ key: 'check', name: 'Check', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} }],
      },
    },
    owner.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, owner.id);
  const rule = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'AUTOMATIC',
      enabled: true,
    },
    { id: owner.id, apiKeyId: 'fixture' },
    { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
    version.id
  );
  const agent = await db.runbookAgent.create({
    data: {
      name: `Sensitive read Agent ${suffix()}`,
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      policyHash: 'b'.repeat(64),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    },
  });
  await db.runbookPolicyCheck.create({
    data: {
      ruleId: rule.id,
      agentId: agent.id,
      versionId: version.id,
      checksum: version.checksum,
      steps: [],
      status: 'PASSED',
      expiresAt: new Date(Date.now() + 3600000),
      checkedAt: new Date(),
      createdById: owner.id,
    },
  });
  return { serviceId: service.id, ruleId: rule.id };
}
async function serviceChangeFixture(owner: Owner) {
  const service = await createTestService('Sensitive read changes');
  await db.auditLog.createMany({
    data: ['service.created', 'service.updated'].map(action => ({
      action,
      entityType: 'SERVICE' as const,
      entityId: service.id,
      actorId: owner.id,
    })),
  });
  return { serviceId: service.id };
}

// --- Status pages -----------------------------------------------------------

async function statusPageFixture() {
  const unique = randomUUID();
  const page = await db.statusPage.create({
    data: {
      name: `Sensitive read page ${unique}`,
      slug: `sensitive-read-${unique}`,
      enabled: true,
      organizationName: 'Sensitive read organization',
      footerText: 'Footer',
    },
  });
  const service = await createTestService('Sensitive read status');
  await linkServiceToStatusPage(page.id, service.id);
  await db.statusPageAsset.create({
    data: {
      id: randomUUID(),
      statusPageId: page.id,
      contentType: 'image/png',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    },
  });
  await publishStatusPageSnapshot(page.id);
  return { pageId: page.id };
}
async function publicationJobFixture(owner: Owner) {
  const { pageId } = await statusPageFixture();
  const job = await db.backgroundJob.create({
    data: {
      id: randomUUID(),
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: new Date(),
      payload: {
        task: 'STATUS_PAGE_PUBLICATION_RETRY',
        pageId,
        actorId: owner.id,
        apiClientId: `client-${suffix()}`,
      },
    },
  });
  return { pageId, jobId: job.id };
}
const pageRead = (name: string, operationId: string): ReadScenario => ({
  name,
  operationId,
  setup: async () => ({ path: { id: (await statusPageFixture()).pageId } }),
});

const scenarios: ReadScenario[] = [
  // Integrations
  { name: 'integration types', operationId: 'listIntegrationTypes', setup: async () => ({}) },
  {
    name: 'integration usage',
    operationId: 'getIntegrationUsage',
    setup: async () => ({ path: { id: (await integrationFixture()).integrationId } }),
  },
  {
    name: 'integrations',
    operationId: 'listIntegrations',
    setup: async () => {
      await integrationFixture();
      return { query: { limit: 10 } };
    },
  },
  // Runbooks
  {
    name: 'runbook delete check',
    operationId: 'checkRunbookDeletion',
    setup: async owner => ({ path: { id: (await draftRunbook(owner)).runbookId } }),
  },
  {
    name: 'runbook version diff',
    operationId: 'compareRunbookVersions',
    setup: async owner => {
      const pair = await versionPair(owner);
      return {
        path: { id: pair.runbookId, versionId: pair.versionId },
        query: { baseVersionId: pair.baseVersionId },
      };
    },
  },
  {
    name: 'runbook draft',
    operationId: 'getRunbookDraft',
    setup: async owner => {
      const draft = await draftRunbook(owner);
      return { path: { id: draft.runbookId, versionId: draft.versionId } };
    },
  },
  {
    name: 'runbook execution events',
    operationId: 'listRunbookExecutionEvents',
    setup: async owner => ({
      path: { id: (await executionFixture(owner)).executionId },
      query: { limit: 10 },
    }),
  },
  {
    name: 'runbook execution evidence',
    operationId: 'listRunbookExecutionEvidence',
    setup: async owner => ({
      path: { id: (await executionFixture(owner)).executionId },
      query: { limit: 10 },
    }),
  },
  {
    name: 'runbook execution steps',
    operationId: 'listRunbookExecutionSteps',
    setup: async owner => ({
      path: { id: (await executionFixture(owner)).executionId },
      query: { limit: 10 },
    }),
  },
  // Schedules
  {
    name: 'schedule dependencies',
    operationId: 'getScheduleDependencies',
    setup: async () => ({ path: { id: (await scheduleFixture()).scheduleId } }),
  },
  {
    name: 'schedule changes',
    operationId: 'listScheduleChanges',
    setup: async () => ({ path: { id: (await scheduleFixture()).scheduleId } }),
  },
  // Service objectives
  {
    name: 'service objective',
    operationId: 'getServiceObjective',
    setup: async () => ({ path: { id: (await objectiveFixture()).lineageId } }),
  },
  {
    name: 'service objective catalog',
    operationId: 'getServiceObjectiveCatalog',
    setup: async () => ({}),
  },
  {
    name: 'service objective evaluation',
    operationId: 'getServiceObjectiveEvaluation',
    setup: async owner => {
      const job = await evaluationFixture(owner);
      return { path: { id: job.lineageId, evaluationId: job.evaluationId } };
    },
  },
  {
    name: 'service objective history',
    operationId: 'getServiceObjectiveHistory',
    setup: async () => ({
      path: { id: (await objectiveFixture()).lineageId },
      query: { limit: 10 },
    }),
  },
  {
    name: 'service objective snapshots',
    operationId: 'listServiceObjectiveSnapshots',
    setup: async () => ({
      path: { id: (await objectiveFixture()).lineageId },
      query: { limit: 10 },
    }),
  },
  {
    name: 'service objective versions',
    operationId: 'listServiceObjectiveVersions',
    setup: async () => ({
      path: { id: (await objectiveFixture()).lineageId },
      query: { limit: 10 },
    }),
  },
  {
    name: 'service objectives',
    operationId: 'listServiceObjectives',
    setup: async () => {
      await objectiveFixture();
      return { query: { limit: 10 } };
    },
  },
  // Services
  {
    name: 'automation candidate',
    operationId: 'getAutomationCandidate',
    setup: async owner => ({ path: { id: (await candidateFixture(owner)).serviceId } }),
  },
  {
    name: 'service notification settings',
    operationId: 'getServiceNotificationSettings',
    setup: async () => ({ path: { id: (await createTestService('Sensitive read notify')).id } }),
  },
  {
    name: 'automation observations',
    operationId: 'listAutomationObservations',
    setup: async () => ({
      path: { id: (await observationFixture()).serviceId },
      query: { limit: 10 },
    }),
  },
  {
    name: 'runbook rule policy checks',
    operationId: 'listRunbookRulePolicyChecks',
    setup: async owner => {
      const rule = await policyCheckFixture(owner);
      return { path: { id: rule.serviceId, ruleId: rule.ruleId }, query: { limit: 10 } };
    },
  },
  {
    name: 'service change events',
    operationId: 'listServiceChangeEvents',
    setup: async owner => ({
      path: { id: (await serviceChangeFixture(owner)).serviceId },
      query: { limit: 10 },
    }),
  },
  // Status pages
  pageRead('status page appearance', 'getStatusPageAppearance'),
  pageRead('status page content', 'getStatusPageContent'),
  pageRead('status page publication', 'getStatusPagePublication'),
  {
    name: 'status page publication job',
    operationId: 'getStatusPagePublicationJob',
    setup: async owner => {
      const job = await publicationJobFixture(owner);
      return { path: { id: job.pageId, jobId: job.jobId } };
    },
  },
  pageRead('status page settings', 'getStatusPageSettings'),
  pageRead('status page subscriber stats', 'getStatusPageSubscriberStats'),
  pageRead('status page subscription settings', 'getStatusPageSubscriptionSettings'),
  pageRead('status page assets', 'listStatusPageAssets'),
  pageRead('status page preview', 'previewStatusPage'),
];

describeSensitiveReads(scenarios);

describe('sensitive configuration reads never disclose credentials or definitions', () => {
  const scopes = (operationId: string) => MCP_OPERATION_MAP.get(operationId)!.requiredScopes;

  it('lists integrations without routing keys, fingerprints or signing secrets', async () => {
    const admin = await principal('ADMIN', scopes('listIntegrations'));
    const fixture = await integrationFixture();
    const result = await callMcpOperation(admin.ctx(), 'listIntegrations', {
      query: { limit: 50, serviceId: fixture.serviceId },
    });
    const rows = (result.data as { data: Array<Record<string, unknown>> }).data;
    expect(rows.map(row => row.id)).toEqual([fixture.integrationId]);
    for (const row of rows)
      for (const field of [
        'key',
        'keyFingerprint',
        'signatureSecret',
        'previousKey',
        'previousKeyFingerprint',
        'previousSignatureSecret',
      ])
        expect(row).not.toHaveProperty(field);
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(fixture.secrets)) expect(serialized).not.toContain(secret);
  });

  it('reports integration usage without credential material', async () => {
    const admin = await principal('ADMIN', scopes('getIntegrationUsage'));
    const fixture = await integrationFixture();
    const result = await callMcpOperation(admin.ctx(), 'getIntegrationUsage', {
      path: { id: fixture.integrationId },
    });
    expect(result.data).toMatchObject({ data: { id: fixture.integrationId } });
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(fixture.secrets)) expect(serialized).not.toContain(secret);
  });

  it('redacts the runbook draft definition entirely', async () => {
    const admin = await principal('ADMIN', scopes('getRunbookDraft'));
    const draft = await draftRunbook(admin.user);
    const result = await callMcpOperation(admin.ctx(), 'getRunbookDraft', {
      path: { id: draft.runbookId, versionId: draft.versionId },
    });
    const { data } = result.data as { data: { id: string; editable: { definition: unknown } } };
    expect(data.id).toBe(draft.versionId);
    expect(data.editable.definition).toBe('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain(DRAFT_MARKER);
  });

  it('compares runbook versions without disclosing step configuration', async () => {
    const admin = await principal('ADMIN', scopes('compareRunbookVersions'));
    const pair = await versionPair(admin.user);
    const result = await callMcpOperation(admin.ctx(), 'compareRunbookVersions', {
      path: { id: pair.runbookId, versionId: pair.versionId },
      query: { baseVersionId: pair.baseVersionId },
    });
    expect(result.data).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(DRAFT_MARKER);
  });
});
