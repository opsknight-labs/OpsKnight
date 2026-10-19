import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import type { Snapshot } from '@/lib/automation/contract';
import {
  buildResponseContext,
  parseResponseContext,
  readIncidentResponseContext,
} from '@/lib/automation/response-context';
import {
  computeDefinitionChecksum,
  computeTriggerFingerprint,
  parseRunbookDefinition,
} from '@/lib/runbooks/definition';
import {
  createServiceBinding,
  replaceBindingTrigger,
  updateServiceBinding,
} from '@/lib/runbooks/bindings';
import { evaluateIncidentTriggers } from '@/lib/runbooks/triggers';
import {
  previewRunbookExecution,
  startTriggeredRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import { loadRunbookIncidentContext } from '@/lib/runbooks/incident-context';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import type { ContextTargetMapping } from '@/lib/runbooks/automation-binding';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const snapshot: Snapshot = {
  schemaVersion: 1,
  fields: [
    {
      fieldId: 'env',
      key: 'environment',
      label: 'Environment',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['production', 'staging'],
      aliases: { prd: 'production' },
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
    },
    {
      fieldId: 'cluster',
      key: 'cluster',
      label: 'Cluster',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.cluster' }],
    },
    {
      fieldId: 'zone',
      key: 'zone',
      label: 'Zone',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.zone' }],
    },
    {
      fieldId: 'replicas',
      key: 'replicas',
      label: 'Replicas',
      type: 'NUMBER',
      caseSensitive: false,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.replicas' }],
    },
    {
      fieldId: 'canary',
      key: 'canary',
      label: 'Canary',
      type: 'BOOLEAN',
      caseSensitive: false,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.canary' }],
    },
  ],
  rules: [
    {
      id: 'prod',
      name: 'Production',
      phase: 'ENRICH',
      enabled: true,
      conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
      actions: [
        { type: 'SET_PRIORITY', value: 'P1' },
        { type: 'ADD_TAG', value: 'role=db' },
      ],
    },
  ],
};

const readOnlyAgentRunbook: RunbookDefinition = {
  steps: [
    {
      key: 'status',
      name: 'Status',
      type: 'SYSTEMD',
      riskClass: 'READ_ONLY',
      config: { action: 'status', unit: 'api.service' },
    },
  ],
};
const waitRunbook: RunbookDefinition = {
  steps: [
    {
      key: 'wait',
      name: 'Wait',
      type: 'WAIT',
      riskClass: 'READ_ONLY',
      config: { durationSeconds: 0 },
    },
  ],
};

async function automatedService(mode: 'LIVE' | 'SHADOW' = 'LIVE') {
  const service = await db.service.create({
    data: { name: `Context ${crypto.randomUUID()}` },
  });
  const actor = await createTestUser({ role: 'ADMIN' });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: actor.id,
    snapshot,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: actor.id,
    mode,
    acknowledgeNoShadow: true,
    expectedActiveVersionId: version.id,
  });
  return { service, actor, version };
}

async function ingest(serviceId: string, details: Record<string, unknown>) {
  const event: EventPayload = {
    event_action: 'trigger',
    dedup_key: crypto.randomUUID(),
    payload: {
      summary: 'Database saturation',
      source: 'monitor',
      severity: 'error',
      custom_details: { ...details, secret_note: 'raw-payload-content' },
    },
  };
  const result = await processIntegrationEvent({
    serviceId,
    integrationId: 'context',
    integrationType: 'EVENTS_API',
    event: structuredClone(event),
    providerPayload: event,
    receivedAt: new Date(),
  });
  return result.incident!.id;
}

/** Mirrors processRunbookJob: the queued payload's source is passed through. */
async function evaluateTriggerJob(incidentId: string) {
  const job = await db.backgroundJob.findFirstOrThrow({
    where: { type: 'RUNBOOK', payload: { path: ['incidentId'], equals: incidentId } },
  });
  const payload = job.payload as { sourceEventId: string; source?: string };
  return {
    sourceEventId: payload.sourceEventId,
    source: payload.source,
    result: await evaluateIncidentTriggers(incidentId, payload.sourceEventId, {
      source: payload.source,
    }),
  };
}

async function publishedRunbook(
  definition: RunbookDefinition,
  inputs: Array<{ key: string; type: 'STRING' | 'NUMBER' | 'BOOLEAN'; required: boolean }> = []
) {
  const parsed = parseRunbookDefinition(definition as unknown as Prisma.InputJsonValue, []);
  const runbook = await db.runbook.create({
    data: { name: `Context ${crypto.randomUUID()}`, slug: `context-${crypto.randomUUID()}` },
  });
  const draft = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
      inputs: {
        create: inputs.map((input, sequence) => ({ ...input, label: input.key, sequence })),
      },
    },
  });
  const version = await db.runbookVersion.update({
    where: { id: draft.id },
    data: { state: 'PUBLISHED', publishedAt: new Date() },
  });
  await db.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  return { runbook, version };
}

type BindOptions = {
  definition?: RunbookDefinition;
  inputs?: Parameters<typeof publishedRunbook>[1];
  mode: 'SUGGESTED' | 'AUTOMATIC';
  conditions: Array<{ field: string; operator: string; value?: unknown }>;
  conditionLogic?: 'AND' | 'OR';
  agentPoolId?: string;
  runOnMonitoringIncidents?: boolean;
  inputValues?: Record<string, unknown>;
  contextInputMappings?: Array<{ inputKey: string; contextKey: string }>;
  contextTargetMappings?: ContextTargetMapping;
};

async function bind(serviceId: string, actorId: string, options: BindOptions) {
  const { runbook, version } = await publishedRunbook(
    options.definition ?? waitRunbook,
    options.inputs
  );
  const binding = await createServiceBinding(
    serviceId,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      enabled: true,
      mode: options.mode,
      versionStrategy: 'PINNED',
      defaultAgentPoolId: options.agentPoolId,
      inputValues: options.inputValues ?? {},
      runOnMonitoringIncidents: options.runOnMonitoringIncidents ?? true,
      contextInputMappings: options.contextInputMappings,
      contextTargetMappings: options.contextTargetMappings,
    },
    actorId
  );
  const trigger = await replaceBindingTrigger(
    serviceId,
    binding.id,
    {
      event: 'INCIDENT_CREATED',
      conditionLogic: options.conditionLogic ?? 'AND',
      enabled: true,
      conditions: options.conditions.map((condition, sequence) => ({
        ...condition,
        operator: condition.operator as 'EQUALS',
        value: condition.value,
        sequence,
      })),
    },
    actorId
  );
  return { runbook, version, binding, trigger };
}

async function agent(labels: Record<string, string> = {}) {
  return db.runbookAgent.create({
    data: {
      name: `agent-${crypto.randomUUID()}`,
      status: 'ONLINE',
      capabilities: ['RUNBOOK_SYSTEMD'],
      lastHeartbeatAt: new Date(),
      labels,
    },
  });
}

async function pool(name: string, agentIds: string[]) {
  return db.runbookAgentPool.create({
    data: {
      name: `${name}-${crypto.randomUUID()}`,
      members: { create: agentIds.map(agentId => ({ agentId })) },
    },
  });
}

async function skipMessages(incidentId: string) {
  return (
    await db.incidentEvent.findMany({
      where: { incidentId, type: 'RUNBOOK_SKIPPED' },
      orderBy: { createdAt: 'asc' },
    })
  ).map(event => event.message);
}

describeIfRealDB('runbook automation context (real PostgreSQL)', () => {
  // Every fixture is uniquely scoped (service, pool, binding, incident), so one reset suffices.
  beforeAll(async () => {
    await resetDatabase();
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: true },
      update: { automationEnabled: true },
    });
  }, 600_000);
  afterAll(async () => db.$disconnect(), 60_000);

  it('stores a checksum-valid response context on LIVE decisions only', async () => {
    const { service, version } = await automatedService();
    const incidentId = await ingest(service.id, { environment: 'PRD', cluster: 'eu-1' });
    const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId },
    });
    const context = parseResponseContext(decision.responseContext);
    expect(context).toMatchObject({ versionId: version.id, versionNumber: version.versionNumber });
    const fields = Object.fromEntries(context!.fields.map(field => [field.key, field]));
    expect(fields.environment).toMatchObject({ value: 'production', source: 'ALERT' });
    expect(fields.zone).toMatchObject({ state: 'MISSING', value: null, source: 'NONE' });
    expect(JSON.stringify(decision.responseContext)).not.toContain('raw-payload-content');
    expect(await readIncidentResponseContext(db, incidentId)).toEqual({
      status: 'AVAILABLE',
      context,
    });
  });

  it('queues monitoring-sourced evaluation for alert incidents', async () => {
    const { service } = await automatedService();
    const incidentId = await ingest(service.id, { environment: 'production' });
    expect((await evaluateTriggerJob(incidentId)).source).toBe('MONITORING');
  });

  it('matches all four field types, priority and tags', async () => {
    const { service, actor } = await automatedService();
    const { binding } = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [
        { field: 'automation.environment', operator: 'EQUALS', value: 'production' },
        { field: 'automation.cluster', operator: 'IN', value: ['eu-1', 'eu-2'] },
        { field: 'automation.replicas', operator: 'IN', value: [3] },
        { field: 'automation.canary', operator: 'EQUALS', value: false },
        { field: 'incident.priority', operator: 'EQUALS', value: 'P1' },
        { field: 'incident.tags', operator: 'CONTAINS', value: 'role=db' },
      ],
    });
    const matching = await ingest(service.id, {
      environment: 'production',
      cluster: 'eu-2',
      replicas: 3,
      canary: false,
    });
    expect((await evaluateTriggerJob(matching)).result).toMatchObject({
      matched: 1,
      suggested: 1,
    });
    const suggestion = await db.runbookSuggestion.findFirstOrThrow({
      where: { incidentId: matching, bindingId: binding.id },
    });
    expect(suggestion.planSnapshot).toMatchObject({
      matchReason: expect.stringContaining('automation.cluster IN ["eu-1","eu-2"]'),
      evaluationSource: 'MONITORING',
    });
    for (const details of [
      { environment: 'production', cluster: 'us-1', replicas: 3, canary: false },
      { environment: 'production', cluster: 'eu-1', replicas: 4, canary: false },
      { environment: 'production', cluster: 'eu-1', replicas: 3, canary: true },
      { environment: 'staging', cluster: 'eu-1', replicas: 3, canary: false },
    ]) {
      const incidentId = await ingest(service.id, details);
      expect((await evaluateTriggerJob(incidentId)).result).toMatchObject({ matched: 0 });
      expect(await skipMessages(incidentId)).toEqual([]);
    }
  });

  it('never matches MISSING with negative comparisons but supports IS_MISSING', async () => {
    const { service, actor } = await automatedService();
    const negative = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'automation.zone', operator: 'NOT_EQUALS', value: 'eu-1a' }],
    });
    const explicit = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'automation.zone', operator: 'IS_MISSING' }],
    });
    const incidentId = await ingest(service.id, { environment: 'production' });
    expect((await evaluateTriggerJob(incidentId)).result).toMatchObject({ matched: 1 });
    expect(
      (await db.runbookSuggestion.findMany({ where: { incidentId } })).map(row => row.bindingId)
    ).toEqual([explicit.binding.id]);
    expect(negative.binding.id).not.toBe(explicit.binding.id);
  });

  it('rejects unknown automation fields and invalid values at authoring time', async () => {
    const { service, actor } = await automatedService();
    await expect(
      bind(service.id, actor.id, {
        mode: 'SUGGESTED',
        conditions: [{ field: 'automation.nope', operator: 'EQUALS', value: 'x' }],
      })
    ).rejects.toThrow('not published');
    await expect(
      bind(service.id, actor.id, {
        mode: 'SUGGESTED',
        conditions: [{ field: 'automation.environment', operator: 'EQUALS', value: 'dev' }],
      })
    ).rejects.toThrow('not an allowed value');
    const canonical = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'automation.environment', operator: 'EQUALS', value: 'PRODUCTION' }],
    });
    expect(canonical.trigger.conditions[0].value).toBe('production');
  });

  it('gates monitoring incidents on the per-binding opt-in; manual incidents are unchanged', async () => {
    const { service, actor } = await automatedService();
    const optedOut = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      runOnMonitoringIncidents: false,
      conditions: [{ field: 'incident.status', operator: 'EQUALS', value: 'OPEN' }],
    });
    const optedIn = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'incident.status', operator: 'EQUALS', value: 'OPEN' }],
    });
    expect(optedOut.binding.runOnMonitoringIncidents).toBe(false);
    const monitoring = await ingest(service.id, { environment: 'production' });
    expect((await evaluateTriggerJob(monitoring)).result).toMatchObject({ matched: 1 });
    expect(
      (await db.runbookSuggestion.findMany({ where: { incidentId: monitoring } })).map(
        row => row.bindingId
      )
    ).toEqual([optedIn.binding.id]);
    const manual = await db.incident.create({
      data: { title: 'Manual', serviceId: service.id, urgency: 'HIGH', status: 'OPEN' },
    });
    expect(
      await evaluateIncidentTriggers(manual.id, crypto.randomUUID(), { source: 'MANUAL' })
    ).toMatchObject({ matched: 2, suggested: 2 });
    // Legacy jobs without a source infer monitoring from linked alerts.
    const legacy = await ingest(service.id, { environment: 'production' });
    expect(await evaluateIncidentTriggers(legacy, crypto.randomUUID())).toMatchObject({
      matched: 1,
    });
  });

  it('never fires automation rules without verified context and records one skip', async () => {
    const { service, actor } = await automatedService('SHADOW');
    const { runbook } = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'automation.cluster', operator: 'IS_MISSING' }],
    });
    const control = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'incident.status', operator: 'EQUALS', value: 'OPEN' }],
    });
    const incidentId = await ingest(service.id, { environment: 'production' });
    const first = await evaluateTriggerJob(incidentId);
    expect(first.result).toMatchObject({ matched: 1, suggested: 1, skipped: 1 });
    await evaluateIncidentTriggers(incidentId, first.sourceEventId, { source: first.source });
    expect(await skipMessages(incidentId)).toEqual([
      `Runbook skipped: ${runbook.name}: AUTOMATION_CONTEXT_UNAVAILABLE: NO_LIVE_DECISION`,
    ]);
    expect(await db.runbookSuggestion.findMany({ where: { incidentId } })).toEqual([
      expect.objectContaining({ bindingId: control.binding.id }),
    ]);
  });

  it('does not match automation conditions after a fallback or when automation is globally off', async () => {
    const { service, actor } = await automatedService();
    await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'automation.environment', operator: 'EQUALS', value: 'production' }],
    });
    await db.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: false },
    });
    try {
      const off = await ingest(service.id, { environment: 'production' });
      expect((await evaluateTriggerJob(off)).result).toMatchObject({ matched: 0, skipped: 1 });
    } finally {
      await db.systemSettings.update({
        where: { id: 'default' },
        data: { automationEnabled: true },
      });
    }
    const fallbackIncident = await db.incident.create({
      data: { title: 'Fallback', serviceId: service.id, urgency: 'HIGH' },
    });
    const config = await db.serviceAutomationConfig.findUniqueOrThrow({
      where: { serviceId: service.id },
    });
    await db.incidentAutomationDecision.create({
      data: {
        incidentId: fallbackIncident.id,
        serviceId: service.id,
        versionId: config.activeVersionId!,
        mode: 'LIVE',
        routeType: 'SERVICE_DEFAULT',
        evaluationAt: new Date(),
        fallbackReason: 'VERSION_INVALID',
        summary: {},
      },
    });
    expect(
      await evaluateIncidentTriggers(fallbackIncident.id, crypto.randomUUID(), {
        source: 'MANUAL',
      })
    ).toMatchObject({ matched: 0 });
    expect((await skipMessages(fallbackIncident.id))[0]).toContain(
      'AUTOMATION_CONTEXT_UNAVAILABLE: FALLBACK'
    );
  });

  it('fails closed on a tampered context row', async () => {
    const { service, actor, version } = await automatedService();
    const { binding } = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditions: [{ field: 'automation.cluster', operator: 'EQUALS', value: 'eu-1' }],
    });
    const incident = await db.incident.create({
      data: { title: 'Tampered', serviceId: service.id, urgency: 'HIGH' },
    });
    const genuine = buildResponseContext({
      versionId: version.id,
      versionNumber: version.versionNumber,
      fields: [{ fieldId: 'cluster', key: 'cluster', type: 'STRING' }],
      inputContext: { cluster: { state: 'RECOGNIZED', value: 'us-1' } },
      enrichedContext: { cluster: { state: 'RECOGNIZED', value: 'us-1' } },
    });
    await db.incidentAutomationDecision.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        versionId: version.id,
        mode: 'LIVE',
        routeType: 'SERVICE_DEFAULT',
        evaluationAt: new Date(),
        summary: {},
        responseContext: {
          ...genuine,
          fields: genuine.fields.map(field => ({ ...field, value: 'eu-1' })),
        },
      },
    });
    const loaded = await loadRunbookIncidentContext(db, incident.id);
    expect(loaded?.trigger.automation).toMatchObject({
      available: false,
      reason: 'INTEGRITY_FAILED',
      fields: null,
    });
    expect(await evaluateIncidentTriggers(incident.id, 'tampered-source')).toMatchObject({
      matched: 0,
    });
    expect(await db.runbookSuggestion.count({ where: { bindingId: binding.id } })).toBe(0);
    expect((await skipMessages(incident.id))[0]).toContain('INTEGRITY_FAILED');
  });

  it('makes a rule referencing a removed field configuration-invalid with a recorded reason', async () => {
    const { service, actor } = await automatedService();
    const { binding, trigger } = await bind(service.id, actor.id, {
      mode: 'SUGGESTED',
      conditionLogic: 'OR',
      conditions: [
        { field: 'incident.status', operator: 'EQUALS', value: 'OPEN' },
        { field: 'automation.cluster', operator: 'EQUALS', value: 'eu-1' },
      ],
    });
    // Simulates the automation schema renaming `cluster` after the rule was authored.
    await db.runbookTriggerCondition.updateMany({
      where: { triggerId: trigger.id, field: 'automation.cluster' },
      data: { field: 'automation.k8s_cluster' },
    });
    const incidentId = await ingest(service.id, { environment: 'production', cluster: 'eu-1' });
    expect((await evaluateTriggerJob(incidentId)).result).toMatchObject({ matched: 0 });
    expect(await db.runbookSuggestion.count({ where: { bindingId: binding.id } })).toBe(0);
    expect((await skipMessages(incidentId))[0]).toContain(
      'AUTOMATION_FIELD_REMOVED: automation.k8s_cluster'
    );
  });

  it('maps context to typed inputs and blocks a missing required input', async () => {
    const { service, actor } = await automatedService();
    const { binding } = await bind(service.id, actor.id, {
      mode: 'AUTOMATIC',
      inputs: [
        { key: 'cluster', type: 'STRING', required: true },
        { key: 'replicas', type: 'NUMBER', required: false },
      ],
      inputValues: { replicas: 1 },
      contextInputMappings: [
        { inputKey: 'cluster', contextKey: 'cluster' },
        { inputKey: 'replicas', contextKey: 'replicas' },
      ],
      conditions: [{ field: 'automation.environment', operator: 'EQUALS', value: 'production' }],
    });
    await expect(
      updateServiceBinding(
        service.id,
        binding.id,
        {
          contextInputMappings: [
            { inputKey: 'cluster', contextKey: 'cluster' },
            { inputKey: 'replicas', contextKey: 'cluster' },
          ],
        },
        actor.id
      )
    ).rejects.toThrow('cannot supply NUMBER');

    const missing = await ingest(service.id, { environment: 'production', replicas: 5 });
    expect((await evaluateTriggerJob(missing)).result).toMatchObject({ started: 0, skipped: 1 });
    expect(await db.runbookExecution.count({ where: { incidentId: missing } })).toBe(0);
    expect((await skipMessages(missing))[0]).toMatch(
      /INPUT_CONTEXT_UNRESOLVED: required input "cluster" maps to automation.cluster, which is MISSING/
    );

    const present = await ingest(service.id, { environment: 'production', cluster: 'eu-1' });
    expect((await evaluateTriggerJob(present)).result).toMatchObject({ started: 1 });
    const execution = await db.runbookExecution.findFirstOrThrow({
      where: { incidentId: present },
    });
    expect(execution.inputValues).toEqual({ cluster: 'eu-1', replicas: 1 });
    expect(execution.executionPlan).toMatchObject({
      inputs: {
        provenance: {
          cluster: { source: 'AUTOMATION_CONTEXT', contextKey: 'cluster' },
          replicas: {
            source: 'BINDING_DEFAULT_FALLBACK',
            contextKey: 'replicas',
            contextState: 'MISSING',
          },
        },
      },
    });
  });

  it('targets only approved pools; unknown clusters and wrong environments are blocked', async () => {
    const { service, actor } = await automatedService();
    const [prodAgent, stagingAgent] = await Promise.all([agent(), agent()]);
    const [prodPool, stagingPool] = await Promise.all([
      pool('prod', [prodAgent.id]),
      pool('staging', [stagingAgent.id]),
    ]);
    const byCluster = await bind(service.id, actor.id, {
      definition: readOnlyAgentRunbook,
      mode: 'AUTOMATIC',
      contextTargetMappings: {
        contextKey: 'cluster',
        entries: [{ value: 'prod-k8s-01', agentPoolId: prodPool.id }],
      },
      conditions: [{ field: 'automation.cluster', operator: 'EXISTS' }],
    });
    const unknown = await ingest(service.id, { environment: 'production', cluster: 'prod-k8s-99' });
    expect((await evaluateTriggerJob(unknown)).result).toMatchObject({ started: 0, skipped: 1 });
    expect((await skipMessages(unknown))[0]).toContain(
      'TARGET_UNMAPPED_VALUE: automation.cluster="prod-k8s-99"'
    );
    const known = await ingest(service.id, { environment: 'production', cluster: 'prod-k8s-01' });
    expect((await evaluateTriggerJob(known)).result).toMatchObject({ started: 1 });
    expect(
      await db.runbookExecution.findFirstOrThrow({
        where: { incidentId: known, bindingId: byCluster.binding.id },
      })
    ).toMatchObject({ resolvedTargetAgentPoolId: prodPool.id });

    await db.serviceRunbookBinding.update({
      where: { id: byCluster.binding.id },
      data: { enabled: false },
    });
    const byEnvironment = await bind(service.id, actor.id, {
      definition: readOnlyAgentRunbook,
      mode: 'AUTOMATIC',
      contextTargetMappings: {
        contextKey: 'environment',
        entries: [
          { value: 'production', agentPoolId: prodPool.id },
          { value: 'Staging', agentPoolId: stagingPool.id },
        ],
      },
      conditions: [],
    });
    expect(byEnvironment.binding.contextTargetMappings).toMatchObject({
      entries: [{ value: 'production' }, { value: 'staging' }],
    });
    const staging = await ingest(service.id, { environment: 'staging', cluster: 'prod-k8s-01' });
    expect((await evaluateTriggerJob(staging)).result).toMatchObject({ started: 1 });
    const stagingExecution = await db.runbookExecution.findFirstOrThrow({
      where: { incidentId: staging, bindingId: byEnvironment.binding.id },
    });
    expect(stagingExecution.resolvedTargetAgentPoolId).toBe(stagingPool.id);
    expect(stagingExecution.executionPlan).toMatchObject({
      target: {
        agentPoolId: stagingPool.id,
        provenance: { kind: 'CONTEXT_MAPPING', contextKey: 'environment', value: 'staging' },
      },
    });
  });

  it('re-checks mapped targets at dispatch and rejects cross-service pools', async () => {
    const serviceA = await automatedService();
    const serviceB = await automatedService();
    const [agentA, agentB] = await Promise.all([agent(), agent()]);
    const [poolA, poolB] = await Promise.all([pool('a', [agentA.id]), pool('b', [agentB.id])]);
    await bind(serviceB.service.id, serviceB.actor.id, {
      definition: readOnlyAgentRunbook,
      mode: 'SUGGESTED',
      contextTargetMappings: {
        contextKey: 'cluster',
        entries: [{ value: 'shared', agentPoolId: poolB.id }],
      },
      conditions: [],
    });
    const suggested = await bind(serviceA.service.id, serviceA.actor.id, {
      definition: readOnlyAgentRunbook,
      mode: 'SUGGESTED',
      contextTargetMappings: {
        contextKey: 'cluster',
        entries: [{ value: 'shared', agentPoolId: poolA.id }],
      },
      conditions: [],
    });
    const incidentId = await ingest(serviceA.service.id, { cluster: 'shared' });
    expect((await evaluateTriggerJob(incidentId)).result).toMatchObject({ suggested: 1 });
    const suggestion = await db.runbookSuggestion.findFirstOrThrow({ where: { incidentId } });
    expect(suggestion.planSnapshot).toMatchObject({
      agentPoolId: poolA.id,
      targetProvenance: { kind: 'CONTEXT_MAPPING' },
    });
    await db.runbookSuggestion.update({
      where: { id: suggestion.id },
      data: {
        planSnapshot: { ...(suggestion.planSnapshot as object), agentPoolId: poolB.id },
      },
    });
    await expect(
      previewRunbookExecution({
        runbookId: suggested.runbook.id,
        incidentId,
        serviceId: serviceA.service.id,
        bindingId: suggested.binding.id,
        suggestionId: suggestion.id,
        triggeredByUserId: serviceA.actor.id,
      })
    ).rejects.toThrow('TARGET_NOT_AUTHORIZED');

    const automatic = await bind(serviceA.service.id, serviceA.actor.id, {
      definition: readOnlyAgentRunbook,
      mode: 'AUTOMATIC',
      contextTargetMappings: {
        contextKey: 'cluster',
        entries: [{ value: 'dead', agentPoolId: poolA.id }],
      },
      conditions: [],
    });
    await db.runbookAgent.update({ where: { id: agentA.id }, data: { status: 'OFFLINE' } });
    const unhealthy = await ingest(serviceA.service.id, { cluster: 'dead' });
    await evaluateTriggerJob(unhealthy);
    expect(
      await db.runbookExecution.count({
        where: { incidentId: unhealthy, bindingId: automatic.binding.id },
      })
    ).toBe(0);
    expect(
      await db.incidentEvent.count({
        where: {
          incidentId: unhealthy,
          type: 'RUNBOOK_FAILED',
          message: { contains: automatic.binding.id },
        },
      })
    ).toBe(1);
  });

  it('pins the execution plan and keeps it unchanged after a binding edit', async () => {
    const { service, actor } = await automatedService();
    const { binding, trigger, version } = await bind(service.id, actor.id, {
      mode: 'AUTOMATIC',
      inputs: [{ key: 'cluster', type: 'STRING', required: true }],
      contextInputMappings: [{ inputKey: 'cluster', contextKey: 'cluster' }],
      conditions: [{ field: 'automation.cluster', operator: 'STARTS_WITH', value: 'eu-' }],
    });
    const incidentId = await ingest(service.id, { environment: 'production', cluster: 'eu-1' });
    const job = await evaluateTriggerJob(incidentId);
    expect(job.result).toMatchObject({ started: 1 });
    // Duplicate evaluations (retry or a second job) never create a second execution.
    await evaluateIncidentTriggers(incidentId, job.sourceEventId, { source: job.source });
    await evaluateIncidentTriggers(incidentId, crypto.randomUUID(), { source: job.source });
    expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(1);

    const execution = await db.runbookExecution.findFirstOrThrow({ where: { incidentId } });
    const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId },
    });
    const context = parseResponseContext(decision.responseContext)!;
    const current = await db.serviceRunbookBinding.findUniqueOrThrow({
      where: { id: binding.id },
    });
    expect(execution.responseContext).toEqual(decision.responseContext);
    expect(execution.executionPlan).toMatchObject({
      evaluationSource: 'MONITORING',
      trigger: {
        bindingId: binding.id,
        configRevision: current.configRevision,
        triggerId: trigger.id,
        triggerFingerprint: execution.triggerFingerprint,
      },
      match: { reason: 'AND: automation.cluster STARTS_WITH "eu-"' },
      runbook: { versionId: version.id, definitionChecksum: version.checksum },
      automation: {
        versionId: context.versionId,
        versionNumber: context.versionNumber,
        contextChecksum: context.checksum,
      },
      inputs: { values: { cluster: 'eu-1' } },
      target: { agentId: null, agentPoolId: null, provenance: { kind: 'NONE' } },
      unattendedWritesAuthorized: false,
    });
    const pinned = structuredClone(execution.executionPlan);
    const edited = await updateServiceBinding(
      service.id,
      binding.id,
      { contextInputMappings: [], inputValues: { cluster: 'static' } },
      actor.id
    );
    expect(edited.configRevision).toBe(current.configRevision + 1);
    const after = await db.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(after.executionPlan).toEqual(pinned);
    expect(after.inputValues).toEqual({ cluster: 'eu-1' });
  });

  it('rejects Agent selectors that read automation context', async () => {
    const { service, actor } = await automatedService();
    const { runbook, version } = await publishedRunbook(readOnlyAgentRunbook);
    const eu = await agent();
    const euPool = await pool('eu', [eu.id]);
    await expect(
      createServiceBinding(
        service.id,
        {
          runbookId: runbook.id,
          runbookVersionId: version.id,
          enabled: true,
          mode: 'AUTOMATIC',
          versionStrategy: 'PINNED',
          defaultAgentPoolId: euPool.id,
          agentSelector: { cluster: '${{ automation.cluster }}' },
          inputValues: {},
        },
        actor.id
      )
    ).rejects.toThrow('approved target mapping table');
  });

  it('re-validates AUTOMATIC executions against the identical verified context', async () => {
    const live = await automatedService();
    const { binding, trigger } = await bind(live.service.id, live.actor.id, {
      mode: 'AUTOMATIC',
      conditions: [{ field: 'automation.cluster', operator: 'EQUALS', value: 'eu-1' }],
    });
    const start = (incidentId: string, evaluationSource?: 'MONITORING' | 'MANUAL') => {
      const sourceEventId = crypto.randomUUID();
      return startTriggeredRunbookExecution({
        runbookId: binding.runbookId,
        runbookVersionId: binding.runbookVersionId!,
        incidentId,
        serviceId: binding.serviceId,
        bindingId: binding.id,
        triggerId: trigger.id,
        sourceEventId,
        evaluationSource,
        triggerFingerprint: computeTriggerFingerprint({
          sourceEventId,
          bindingId: binding.id,
          runbookVersionId: binding.runbookVersionId!,
        }),
      });
    };
    const wrongCluster = await ingest(live.service.id, { cluster: 'us-1' });
    await expect(start(wrongCluster)).rejects.toThrow('AUTOMATION_NOT_AUTHORIZED');
    const noContext = await db.incident.create({
      data: { title: 'No decision', serviceId: live.service.id, urgency: 'HIGH' },
    });
    await expect(start(noContext.id)).rejects.toThrow('AUTOMATION_NOT_AUTHORIZED');
    const matching = await ingest(live.service.id, { cluster: 'eu-1' });
    await db.serviceRunbookBinding.update({
      where: { id: binding.id },
      data: { runOnMonitoringIncidents: false },
    });
    await expect(start(matching, 'MONITORING')).rejects.toThrow('AUTOMATION_NOT_AUTHORIZED');
    const execution = await start(matching, 'MANUAL');
    const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId: matching },
    });
    expect(execution.responseContext).toEqual(decision.responseContext);
  });
});
