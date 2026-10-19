/**
 * End-to-end certification of the Service Automation ↔ Runbook Engine integration.
 *
 * Every incident enters through the real Events API ingestion path
 * (processIntegrationEvent → prepareAutomation/persistAutomation → durable outbox),
 * and every runbook transition is driven through the durable RUNBOOK job lane
 * (processJob → processRunbookJob) plus the Agent claim/fence/result protocol.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestNotificationProvider,
} from '../helpers/test-db';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import type { Snapshot } from '@/lib/automation/contract';
import { parseResponseContext } from '@/lib/automation/response-context';
import { processJob } from '@/lib/jobs/queue';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import {
  authorizeUnattendedWrites,
  createServiceBinding,
  replaceBindingTrigger,
} from '@/lib/runbooks/bindings';
import { processRunbookJob } from '@/lib/runbooks/orchestrator';
import * as runbookTriggers from '@/lib/runbooks/triggers';
import {
  claimAgentAttempt,
  fenceAgentAttempt,
  submitAgentResult,
} from '@/lib/runbooks/agent-claims';
import { claimEscalationStep } from '@/lib/escalation/repository';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { getIncidentResponseTimeline } from '@/lib/incidents/response-timeline';
import { CAPABILITIES } from '@/lib/authorization';
import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/slack', () => ({ sendSlackMessageToChannel: vi.fn() }));
vi.mock('@/lib/notification-control-plane', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/notification-control-plane')>()),
  // Durable paging intents are produced for real; no external provider is contacted.
  deliverCentralNotification: vi.fn(async () => ({ success: false })),
}));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const HOOK_TIMEOUT = 240_000;
const TEST_TIMEOUT = 240_000;
const RAW_SECRET = 'hunter2-raw-payload-secret';
const RAW_NOTE = 'raw-payload-only-note';
const VIEWER = { capabilities: Object.values(CAPABILITIES) as string[] };

type KubernetesState = {
  desired: number;
  ready: number;
  observedGeneration: number;
  generation: number;
};
const DEGRADED: KubernetesState = { desired: 3, ready: 1, observedGeneration: 4, generation: 4 };
const HEALTHY: KubernetesState = { desired: 3, ready: 3, observedGeneration: 5, generation: 5 };

const target = { namespace: 'shop', resource: 'deployment', name: 'checkout' };
const verifyRollout: RunbookStepDefinition = {
  key: 'verify-rollout',
  name: 'Verify checkout rollout',
  type: 'KUBERNETES',
  riskClass: 'READ_ONLY',
  config: { action: 'rollout-status', ...target },
};
/**
 * Kubernetes `scale` is the platform's IDEMPOTENT_WRITE recovery action. `rollout-restart`
 * is classified NON_IDEMPOTENT by the definition validator and therefore always requires
 * approval, so it can never run unattended (asserted in the safety scenario).
 */
const RECOVER_CHECKOUT: RunbookDefinition = {
  steps: [
    {
      key: 'scale-checkout',
      name: 'Scale checkout to 3 replicas',
      type: 'KUBERNETES',
      riskClass: 'IDEMPOTENT_WRITE',
      config: { action: 'scale', ...target, replicas: 3 },
      verification: { steps: [verifyRollout] },
    },
  ],
};

function automationSnapshot(criticalPolicyId: string): Snapshot {
  const field = (key: string, type: 'STRING' | 'ENUM', allowedValues?: string[]) => ({
    fieldId: `f-${key}`,
    key,
    label: key[0].toUpperCase() + key.slice(1),
    type,
    caseSensitive: type === 'STRING',
    ...(allowedValues ? { allowedValues } : {}),
    aliases: {},
    mappings: [{ source: 'EVENT' as const, path: `payload.custom_details.${key}` }],
  });
  const productionKubernetes = [
    { fieldKey: 'environment', operator: 'EQ' as const, value: 'production' },
    { fieldKey: 'platform', operator: 'EQ' as const, value: 'kubernetes' },
  ];
  return {
    schemaVersion: 1,
    fields: [
      field('environment', 'ENUM', ['production', 'staging']),
      field('platform', 'ENUM', ['kubernetes', 'vm']),
      field('cluster', 'STRING'),
      field('region', 'STRING'),
      field('application', 'STRING'),
    ],
    rules: [
      {
        id: 'prod-k8s-priority',
        name: 'Production Kubernetes is P1',
        phase: 'ENRICH',
        enabled: true,
        conditions: productionKubernetes,
        actions: [{ type: 'SET_PRIORITY', value: 'P1' }],
      },
      {
        id: 'prod-k8s-route',
        name: 'Production Kubernetes pages critical',
        phase: 'ROUTE',
        enabled: true,
        conditions: productionKubernetes,
        actions: [{ type: 'USE_ESCALATION_POLICY', policyId: criticalPolicyId }],
      },
    ],
  };
}

async function publishedRunbook(definition: RunbookDefinition) {
  const parsed = parseRunbookDefinition(definition as unknown as Prisma.InputJsonValue, []);
  const runbook = await db.runbook.create({
    data: { name: `Recover checkout ${crypto.randomUUID()}`, slug: `e2e-${crypto.randomUUID()}` },
  });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
    },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
  return { runbook, version };
}

async function kubernetesAgent(cluster: string) {
  return db.runbookAgent.create({
    data: {
      name: `k8s-${cluster}-${crypto.randomUUID().slice(0, 8)}`,
      status: 'ONLINE',
      capabilities: ['RUNBOOK_KUBERNETES'],
      lastHeartbeatAt: new Date(),
      labels: { cluster },
    },
  });
}

interface FixtureOptions {
  mode?: 'LIVE' | 'SHADOW';
  authorize?: boolean;
  resolveOnVerifiedRecovery?: boolean;
}

/** One isolated tenant slice: service, automation version, paging policies, pool and binding. */
async function createFixture(options: FixtureOptions = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const admin = await createTestUser({ role: 'ADMIN', name: `Admin ${suffix}` });
  const responder = await createTestUser({
    role: 'RESPONDER',
    name: `Responder ${suffix}`,
    emailNotificationsEnabled: true,
  });
  const step = (stepOrder: number, delayMinutes: number) => ({
    stepOrder,
    delayMinutes,
    targetType: 'USER' as const,
    targetUserId: responder.id,
    notificationChannels: ['EMAIL' as const],
  });
  const critical = await db.escalationPolicy.create({
    data: { name: `Critical ${suffix}`, steps: { create: [step(0, 0), step(1, 5)] } },
  });
  const standard = await db.escalationPolicy.create({
    data: { name: `Standard ${suffix}`, steps: { create: [step(0, 15)] } },
  });
  const service = await db.service.create({
    data: { name: `Checkout ${suffix}`, escalationPolicyId: standard.id },
  });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: admin.id,
    snapshot: automationSnapshot(critical.id),
    expectedRevision: 0,
  });
  const automationVersion = await publishVersion({
    serviceId: service.id,
    actorId: admin.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: admin.id,
    mode: options.mode ?? 'LIVE',
    acknowledgeNoShadow: true,
    expectedActiveVersionId: automationVersion.id,
  });

  const clusters = { eu: `prod-eu-${suffix}`, us: `prod-us-${suffix}` };
  const euAgent = await kubernetesAgent(clusters.eu);
  const usAgent = await kubernetesAgent(clusters.us);
  const pool = await db.runbookAgentPool.create({
    data: {
      name: `Approved k8s ${suffix}`,
      members: { create: [{ agentId: euAgent.id }, { agentId: usAgent.id }] },
    },
  });
  const { runbook, version } = await publishedRunbook(RECOVER_CHECKOUT);
  let binding = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      enabled: true,
      mode: 'AUTOMATIC',
      versionStrategy: 'PINNED',
      defaultAgentPoolId: pool.id,
      inputValues: {},
      resolveOnVerifiedRecovery: options.resolveOnVerifiedRecovery ?? true,
      // Alert-created incidents only reach bindings that explicitly opt in.
      runOnMonitoringIncidents: true,
      // The alert can only choose among admin-approved value → Agent rows.
      contextTargetMappings: {
        contextKey: 'cluster',
        entries: [
          { value: clusters.eu, agentId: euAgent.id },
          { value: clusters.us, agentId: usAgent.id },
        ],
      },
    },
    admin.id
  );
  await replaceBindingTrigger(
    service.id,
    binding.id,
    {
      event: 'INCIDENT_CREATED',
      conditionLogic: 'AND',
      enabled: true,
      conditions: [
        { field: 'incident.priority', operator: 'EQUALS', value: 'P1', sequence: 0 },
        { field: 'automation.environment', operator: 'EQUALS', value: 'production', sequence: 1 },
      ],
    },
    admin.id
  );
  if (options.authorize ?? true)
    binding = await authorizeUnattendedWrites(
      service.id,
      binding.id,
      { expectedVersionId: version.id },
      admin.id
    );
  return {
    admin,
    responder,
    critical,
    standard,
    service,
    automationVersion,
    clusters,
    euAgent,
    usAgent,
    pool,
    runbook,
    version,
    binding,
  };
}
type Fixture = Awaited<ReturnType<typeof createFixture>>;

function alert(fixture: Fixture, overrides: Record<string, unknown> = {}, dedupKey?: string) {
  const event: EventPayload = {
    event_action: 'trigger',
    dedup_key: dedupKey ?? crypto.randomUUID(),
    payload: {
      summary: 'Checkout pods crash-looping',
      source: 'prometheus',
      severity: 'critical',
      custom_details: {
        environment: 'production',
        platform: 'kubernetes',
        cluster: fixture.clusters.eu,
        region: 'eu-west-1',
        application: 'checkout',
        db_password: RAW_SECRET,
        operator_note: RAW_NOTE,
        ...overrides,
      },
    },
  };
  return event;
}

async function ingest(serviceId: string, event: EventPayload) {
  return processIntegrationEvent({
    serviceId,
    integrationId: 'e2e-events-api',
    integrationType: 'EVENTS_API',
    event: structuredClone(event),
    providerPayload: event,
    receivedAt: new Date(),
  });
}

async function ingestIncident(fixture: Fixture, event: EventPayload = alert(fixture)) {
  const result = await ingest(fixture.service.id, event);
  expect(result.incident).toBeTruthy();
  return result.incident!.id;
}

function runbookJobsWhere(
  incidentId: string,
  executionIds: string[]
): Prisma.BackgroundJobWhereInput {
  return {
    type: 'RUNBOOK',
    OR: [
      { payload: { path: ['incidentId'], equals: incidentId } },
      ...executionIds.map(executionId => ({
        payload: { path: ['executionId'], equals: executionId },
      })),
    ],
  };
}

async function evaluateTriggerJob(incidentId: string) {
  return db.backgroundJob.findFirstOrThrow({
    where: {
      type: 'RUNBOOK',
      AND: [
        { payload: { path: ['kind'], equals: 'EVALUATE_TRIGGER' } },
        { payload: { path: ['incidentId'], equals: incidentId } },
      ],
    },
  });
}

/**
 * Runs the isolated RUNBOOK worker lane for one incident through the real job processor.
 * VERIFIED_RESOLUTION jobs are left pending unless requested so tests can observe them.
 */
async function drainRunbookJobs(incidentId: string, options: { includeResolution?: boolean } = {}) {
  let processed = 0;
  for (let round = 0; round < 25; round++) {
    const executionIds = (
      await db.runbookExecution.findMany({ where: { incidentId }, select: { id: true } })
    ).map(execution => execution.id);
    const jobs = await db.backgroundJob.findMany({
      where: {
        ...runbookJobsWhere(incidentId, executionIds),
        status: 'PENDING',
        scheduledAt: { lte: new Date() },
        ...(options.includeResolution
          ? {}
          : { NOT: { payload: { path: ['kind'], equals: 'VERIFIED_RESOLUTION' } } }),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!jobs.length) return processed;
    for (const job of jobs) {
      await processJob(job.id);
      processed++;
    }
  }
  throw new Error('Runbook job lane did not settle');
}

async function verifiedResolutionJobs(executionId: string) {
  return db.backgroundJob.findMany({
    where: {
      type: 'RUNBOOK',
      AND: [
        { payload: { path: ['kind'], equals: 'VERIFIED_RESOLUTION' } },
        { payload: { path: ['executionId'], equals: executionId } },
      ],
    },
  });
}

async function escalationJob(incidentId: string, stepIndex = 0) {
  return db.backgroundJob.findFirst({
    where: {
      type: 'ESCALATION',
      AND: [
        { payload: { path: ['incidentId'], equals: incidentId } },
        { payload: { path: ['stepIndex'], equals: stepIndex } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Simulates the Agent: claim the attempt dispatched to it, fence it and report evidence. */
async function agentReports(
  incidentId: string,
  agentId: string,
  result: { status?: 'SUCCEEDED' | 'FAILED'; pre?: KubernetesState; post?: KubernetesState }
) {
  await drainRunbookJobs(incidentId);
  const claim = await claimAgentAttempt(agentId);
  expect(claim).not.toBeNull();
  await fenceAgentAttempt({ attemptId: claim!.attemptId, agentId, leaseToken: claim!.leaseToken });
  const capturedAt = new Date().toISOString();
  await submitAgentResult(agentId, {
    attemptId: claim!.attemptId,
    leaseToken: claim!.leaseToken,
    status: result.status ?? 'SUCCEEDED',
    ...(result.status === 'FAILED' ? { errorCode: 'CHECK_FAILED', exitCode: 1 } : {}),
    ...(result.pre ? { preState: { capturedAt, kubernetesState: result.pre } } : {}),
    ...(result.post ? { postState: { capturedAt, kubernetesState: result.post } } : {}),
  });
  await drainRunbookJobs(incidentId);
}

/** Scale action recovered the deployment and the rollout check proved it. */
async function recoverCheckout(incidentId: string, agentId: string, verifyPost = HEALTHY) {
  await agentReports(incidentId, agentId, { pre: DEGRADED, post: HEALTHY });
  await agentReports(incidentId, agentId, { pre: HEALTHY, post: verifyPost });
}

async function onlyExecution(incidentId: string) {
  const executions = await db.runbookExecution.findMany({ where: { incidentId } });
  expect(executions).toHaveLength(1);
  return executions[0];
}

describeIfRealDB(
  'runbook automation end-to-end certification (real PostgreSQL)',
  { timeout: TEST_TIMEOUT },
  () => {
    // Each scenario builds an isolated service/pool/binding slice, so one reset suffices.
    beforeAll(async () => {
      await resetDatabase();
      await db.systemSettings.upsert({
        where: { id: 'default' },
        create: { automationEnabled: true },
        update: { automationEnabled: true },
      });
      // Responders are reachable by email; delivery itself is mocked above.
      await createTestNotificationProvider('smtp', {
        host: '127.0.0.1',
        port: 2525,
        user: 'runbook-e2e',
        password: 'runbook-e2e-local-only',
        fromEmail: 'runbook-e2e@example.com',
      });
    }, HOOK_TIMEOUT);
    afterAll(async () => db.$disconnect(), HOOK_TIMEOUT);

    describe('a) golden path', () => {
      it('routes, pages, remediates in the matching cluster, verifies and resolves', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);

        // Routing + paging are committed by ingestion, before the runbook lane runs at all.
        const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(incident).toMatchObject({
          status: 'OPEN',
          priority: 'P1',
          escalationStatus: 'ESCALATING',
          currentEscalationStep: 0,
        });
        expect(incident.nextEscalationAt).toBeInstanceOf(Date);
        expect(incident.nextEscalationAt!.getTime()).toBeLessThanOrEqual(Date.now());
        const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
          where: { incidentId },
        });
        expect(decision).toMatchObject({
          mode: 'LIVE',
          routeType: 'ESCALATION_POLICY',
          escalationPolicyId: fixture.critical.id,
          finalPriority: 'P1',
          fallbackReason: null,
        });
        const firstPage = await escalationJob(incidentId, 0);
        expect(firstPage).toMatchObject({ status: 'PENDING' });
        expect(firstPage!.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(await evaluateTriggerJob(incidentId)).toMatchObject({ status: 'PENDING' });
        expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(0);

        // Paging runs on its own lane and is never gated on remediation.
        expect(await processJob(firstPage!.id)).toBe(true);
        expect(await db.notification.count({ where: { incidentId } })).toBeGreaterThan(0);
        const paged = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(paged).toMatchObject({ status: 'OPEN', escalationStatus: 'ESCALATING' });
        expect(paged.nextEscalationAt!.getTime()).toBeGreaterThan(Date.now());

        await drainRunbookJobs(incidentId);
        const execution = await onlyExecution(incidentId);
        expect(execution).toMatchObject({
          bindingId: fixture.binding.id,
          triggeredByType: 'TRIGGER',
          resolvedTargetAgentId: fixture.euAgent.id,
          unattendedWritesAuthorized: true,
        });
        expect(execution.targetSelection).toMatchObject({
          selectedAgentId: fixture.euAgent.id,
          provenance: {
            kind: 'CONTEXT_MAPPING',
            contextKey: 'cluster',
            value: fixture.clusters.eu,
          },
        });
        expect(execution.responseContext).toEqual(decision.responseContext);
        expect(
          await db.incidentEvent.count({
            where: { incidentId, type: { in: ['RUNBOOK_FAILED', 'RUNBOOK_SKIPPED'] } },
          })
        ).toBe(0);
        // The agent in the other cluster is never handed the write.
        expect(await claimAgentAttempt(fixture.usAgent.id)).toBeNull();

        await recoverCheckout(incidentId, fixture.euAgent.id);
        const completed = await db.runbookExecution.findUniqueOrThrow({
          where: { id: execution.id },
        });
        expect(completed).toMatchObject({ status: 'SUCCEEDED', recoveryOutcome: 'PENDING' });
        expect(
          await db.incidentEvent.count({ where: { incidentId, type: 'RUNBOOK_VERIFIED' } })
        ).toBe(1);
        // Runbook success alone does not resolve; the durable recovery job does.
        expect((await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).status).toBe(
          'OPEN'
        );
        const [resolutionJob] = await verifiedResolutionJobs(execution.id);
        expect(resolutionJob).toMatchObject({ status: 'PENDING' });
        expect(await processJob(resolutionJob.id)).toBe(true);

        const resolved = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(resolved).toMatchObject({
          status: 'RESOLVED',
          resolutionKind: 'AUTOMATION',
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        });
        const autoResolved = await db.incidentEvent.findMany({
          where: { incidentId, type: 'AUTO_RESOLVED' },
        });
        expect(autoResolved.map(event => event.message)).toEqual([
          `Resolved after verified recovery: ${fixture.runbook.name}`,
        ]);
        expect(
          await db.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ recoveryOutcome: 'RESOLVED' });
        expect(
          await claimEscalationStep({
            incidentId,
            stepIndex: 1,
            expectedGeneration: resolved.escalationGeneration,
            now: new Date(Date.now() + 10 * 60_000),
            lockTimeoutMs: 60_000,
          })
        ).toEqual({ claimed: false, reason: 'SUPERSEDED' });
        // A stale second-level page job is a settled no-op after resolution.
        const notificationsBefore = await db.notification.count({ where: { incidentId } });
        const secondPage = await escalationJob(incidentId, 1);
        if (secondPage?.status === 'PENDING') {
          await db.backgroundJob.update({
            where: { id: secondPage.id },
            data: { scheduledAt: new Date() },
          });
          expect(await processJob(secondPage.id)).toBe(true);
        }
        expect(await db.notification.count({ where: { incidentId } })).toBe(notificationsBefore);

        const timeline = await getIncidentResponseTimeline(incidentId, VIEWER);
        expect(timeline).not.toBeNull();
        const firstIndex = (predicate: (kind: string, lane: string) => boolean) =>
          timeline!.entries.findIndex(entry => predicate(entry.kind, entry.lane));
        const routing = firstIndex(kind => kind === 'ROUTING_DECISION');
        const paging = firstIndex(
          (kind, lane) =>
            lane === 'PAGING' && (kind === 'NOTIFICATION' || kind === 'ESCALATION_STEP')
        );
        const remediation = firstIndex(kind => kind === 'RUNBOOK_EXECUTION');
        const verification = firstIndex(kind => kind === 'WRITE_VERIFICATION');
        const recovery = firstIndex(kind => kind === 'RECOVERY_OUTCOME');
        const lifecycle = timeline!.entries.findIndex(
          entry => entry.kind === 'LIFECYCLE' && entry.transition === 'RESOLVED'
        );
        for (const index of [routing, paging, remediation, verification, recovery, lifecycle])
          expect(index).toBeGreaterThanOrEqual(0);
        expect(routing).toBeLessThan(paging);
        expect(paging).toBeLessThan(remediation);
        expect(remediation).toBeLessThan(verification);
        expect(verification).toBeLessThanOrEqual(recovery);
        expect(timeline!.entries.at(recovery)).toMatchObject({ outcome: 'RESOLVED' });
        expect(timeline!.entries.at(lifecycle)).toMatchObject({ resolutionKind: 'AUTOMATION' });
        expect(timeline!.context).toMatchObject({ status: 'AVAILABLE' });
      });
    });

    describe('b) paging independence', () => {
      it('pages while the runbook lane is never run', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        const page = await escalationJob(incidentId, 0);
        expect(page).toMatchObject({ status: 'PENDING' });
        expect(await processJob(page!.id)).toBe(true);
        expect(await db.notification.count({ where: { incidentId } })).toBeGreaterThan(0);
        expect(await escalationJob(incidentId, 1)).toMatchObject({ status: 'PENDING' });
        expect(await evaluateTriggerJob(incidentId)).toMatchObject({ status: 'PENDING' });
        expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(0);
      });

      it('keeps the incident and escalation intact when the runbook job fails', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        const outage = vi
          .spyOn(runbookTriggers, 'evaluateIncidentTriggers')
          .mockRejectedValue(new Error('simulated runbook lane outage'));
        try {
          const job = await evaluateTriggerJob(incidentId);
          expect(await processJob(job.id)).toBe(false);
          const failed = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
          // The durable job is rescheduled with backoff instead of being lost.
          expect(failed).toMatchObject({ status: 'PENDING', attempts: 1, claimToken: null });
          expect(failed.scheduledAt.getTime()).toBeGreaterThan(Date.now());
        } finally {
          outage.mockRestore();
        }
        const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(incident).toMatchObject({
          status: 'OPEN',
          priority: 'P1',
          escalationStatus: 'ESCALATING',
          currentEscalationStep: 0,
        });
        expect(await db.incidentAutomationDecision.count({ where: { incidentId } })).toBe(1);
        const page = await escalationJob(incidentId, 0);
        expect(await processJob(page!.id)).toBe(true);
        expect(await db.notification.count({ where: { incidentId } })).toBeGreaterThan(0);

        // The durable job retries once the lane recovers.
        const retry = await evaluateTriggerJob(incidentId);
        await db.backgroundJob.update({
          where: { id: retry.id },
          data: { status: 'PENDING', scheduledAt: new Date() },
        });
        await drainRunbookJobs(incidentId);
        expect((await onlyExecution(incidentId)).resolvedTargetAgentId).toBe(fixture.euAgent.id);
      });
    });

    describe('c) safety', () => {
      it('holds unauthorized writes for approval while paging continues', async () => {
        const fixture = await createFixture({ authorize: false });
        const dedupKey = `checkout-${crypto.randomUUID()}`;
        const incidentId = await ingestIncident(fixture, alert(fixture, {}, dedupKey));
        await drainRunbookJobs(incidentId);
        const execution = await onlyExecution(incidentId);
        expect(execution).toMatchObject({
          status: 'WAITING_APPROVAL',
          unattendedWritesAuthorized: false,
        });
        const scale = await db.runbookExecutionStep.findFirstOrThrow({
          where: { executionId: execution.id, stepKey: 'scale-checkout' },
        });
        expect(scale).toMatchObject({ requiresApproval: true, status: 'WAITING_APPROVAL' });
        expect(
          await db.runbookStepAttempt.count({
            where: { executionStep: { executionId: execution.id } },
          })
        ).toBe(0);
        expect(await claimAgentAttempt(fixture.euAgent.id)).toBeNull();

        // Repeated alerts deduplicate into the same incident: no extra evaluation or execution.
        for (let repeat = 0; repeat < 3; repeat++) {
          const result = await ingest(fixture.service.id, alert(fixture, {}, dedupKey));
          expect(result.incident?.id).toBe(incidentId);
        }
        await drainRunbookJobs(incidentId);
        expect(await db.incident.count({ where: { serviceId: fixture.service.id } })).toBe(1);
        expect(
          await db.backgroundJob.count({
            where: {
              type: 'RUNBOOK',
              AND: [
                { payload: { path: ['kind'], equals: 'EVALUATE_TRIGGER' } },
                { payload: { path: ['incidentId'], equals: incidentId } },
              ],
            },
          })
        ).toBe(1);
        expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(1);

        const open = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(open).toMatchObject({ status: 'OPEN', escalationStatus: 'ESCALATING' });
        const page = await escalationJob(incidentId, 0);
        expect(await processJob(page!.id)).toBe(true);
        expect(await db.notification.count({ where: { incidentId } })).toBeGreaterThan(0);
        const timeline = await getIncidentResponseTimeline(incidentId, VIEWER);
        expect(timeline!.entries).toContainEqual(
          expect.objectContaining({ kind: 'RUNBOOK_APPROVAL', state: 'REQUIRED' })
        );
      });

      it('cannot be steered by the alert payload to an Agent outside the approved pool', async () => {
        const fixture = await createFixture();
        const rogueCluster = `rogue-${crypto.randomUUID().slice(0, 8)}`;
        const rogue = await kubernetesAgent(rogueCluster);
        const incidentId = await ingestIncident(fixture, alert(fixture, { cluster: rogueCluster }));
        await drainRunbookJobs(incidentId);
        expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(0);
        const skipped = await db.incidentEvent.findMany({
          where: { incidentId, type: 'RUNBOOK_SKIPPED' },
        });
        expect(skipped).toHaveLength(1);
        expect(skipped[0].message).toContain(fixture.runbook.name);
        expect(skipped[0].message).toContain('TARGET_UNMAPPED_VALUE');
        expect(await claimAgentAttempt(rogue.id)).toBeNull();
        expect(await db.runbookStepAttempt.count({ where: { targetAgentId: rogue.id } })).toBe(0);
        // Paging is unaffected by the refused remediation.
        expect(await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).toMatchObject({
          status: 'OPEN',
          escalationStatus: 'ESCALATING',
        });
      });

      it('never lets rollout-restart masquerade as an unattended IDEMPOTENT_WRITE', () => {
        expect(() =>
          parseRunbookDefinition(
            {
              steps: [
                {
                  key: 'restart',
                  name: 'Restart checkout',
                  type: 'KUBERNETES',
                  riskClass: 'IDEMPOTENT_WRITE',
                  config: { action: 'rollout-restart', ...target },
                },
              ],
            } as unknown as Prisma.InputJsonValue,
            []
          )
        ).toThrow('NON_IDEMPOTENT');
      });
    });

    describe('d) security and integrity', () => {
      it('fails closed on SHADOW services with RUNBOOK_SKIPPED and still pages', async () => {
        const fixture = await createFixture({ mode: 'SHADOW' });
        const incidentId = await ingestIncident(fixture);
        expect(await db.incidentAutomationDecision.count({ where: { incidentId } })).toBe(0);
        await drainRunbookJobs(incidentId);
        expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(0);
        const skipped = await db.incidentEvent.findMany({
          where: { incidentId, type: 'RUNBOOK_SKIPPED' },
        });
        expect(skipped).toHaveLength(1);
        expect(skipped[0].message).toContain(fixture.runbook.name);
        expect(skipped[0].message).toContain('AUTOMATION_CONTEXT_UNAVAILABLE');
        expect(skipped[0].message).toContain('NO_LIVE_DECISION');
        expect(await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).toMatchObject({
          status: 'OPEN',
          escalationStatus: 'ESCALATING',
        });
        expect(await escalationJob(incidentId, 0)).toMatchObject({ status: 'PENDING' });
      });

      it('rejects any UPDATE of the captured response context', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
          where: { incidentId },
        });
        const context = parseResponseContext(decision.responseContext)!;
        expect(context).not.toBeNull();
        const forged = {
          ...context,
          fields: context.fields.map(field =>
            field.key === 'cluster' ? { ...field, value: 'attacker-cluster' } : field
          ),
        };
        await expect(
          db.incidentAutomationDecision.update({
            where: { incidentId },
            data: { responseContext: forged as unknown as Prisma.InputJsonValue },
          })
        ).rejects.toThrow();
        await expect(
          db.$executeRaw`UPDATE "IncidentAutomationDecision" SET "responseContext" = NULL WHERE "incidentId" = ${incidentId}`
        ).rejects.toThrow();
        expect(
          (await db.incidentAutomationDecision.findUniqueOrThrow({ where: { incidentId } }))
            .responseContext
        ).toEqual(decision.responseContext);
      });

      it('never copies undeclared raw payload fields into context, executions or the timeline', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        await drainRunbookJobs(incidentId);
        const execution = await onlyExecution(incidentId);
        const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
          where: { incidentId },
        });
        const context = parseResponseContext(decision.responseContext)!;
        const declared = new Set(['environment', 'platform', 'cluster', 'region', 'application']);
        const keys = context.fields.map(field => field.key);
        for (const key of declared) expect(keys).toContain(key);
        expect(keys).not.toContain('db_password');
        expect(keys).not.toContain('operator_note');
        const timeline = await getIncidentResponseTimeline(incidentId, VIEWER);
        for (const persisted of [
          decision.responseContext,
          execution.responseContext,
          execution.targetSelection,
          timeline,
        ]) {
          const serialized = JSON.stringify(persisted);
          expect(serialized).not.toContain(RAW_SECRET);
          expect(serialized).not.toContain(RAW_NOTE);
          expect(serialized).not.toContain('db_password');
        }
      });
    });

    describe('e) recovery', () => {
      it('creates exactly one execution and one resolution across crashed and retried jobs', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        const job = await evaluateTriggerJob(incidentId);
        expect(await processJob(job.id)).toBe(true);
        // Worker crashed after commit: the lease is reclaimed and the same payload replays.
        await db.backgroundJob.update({
          where: { id: job.id },
          data: { status: 'PENDING', claimToken: null, completedAt: null },
        });
        expect(await processJob(job.id)).toBe(true);
        await processRunbookJob(job.payload);
        const execution = await onlyExecution(incidentId);
        // A replayed evaluation is recognised as already handled, not reported as a failure.
        expect(
          await db.incidentEvent.count({
            where: { incidentId, type: { in: ['RUNBOOK_FAILED', 'RUNBOOK_SKIPPED'] } },
          })
        ).toBe(0);

        await recoverCheckout(incidentId, fixture.euAgent.id);
        const resolutionJobs = await verifiedResolutionJobs(execution.id);
        expect(resolutionJobs).toHaveLength(1);
        expect(await processJob(resolutionJobs[0].id)).toBe(true);
        await processRunbookJob(resolutionJobs[0].payload);
        await processRunbookJob(resolutionJobs[0].payload);

        expect(await db.runbookExecution.count({ where: { incidentId } })).toBe(1);
        expect(await db.incidentEvent.count({ where: { incidentId, type: 'AUTO_RESOLVED' } })).toBe(
          1
        );
        expect(await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).toMatchObject({
          status: 'RESOLVED',
          resolutionKind: 'AUTOMATION',
        });
        expect(
          await db.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ recoveryOutcome: 'RESOLVED' });
      });

      it('reports ALREADY_CLOSED when a responder resolves before verification finishes', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        await drainRunbookJobs(incidentId);
        const execution = await onlyExecution(incidentId);
        await agentReports(incidentId, fixture.euAgent.id, { pre: DEGRADED, post: HEALTHY });
        await db.$transaction(tx =>
          applyIncidentLifecycleCommand(tx, {
            incidentId,
            command: 'RESOLVE',
            source: 'WEB',
            actor: { id: fixture.responder.id, name: fixture.responder.name ?? undefined },
            resolutionNote: 'Rolled back the bad deploy by hand',
          })
        );
        const manual = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(manual.status).toBe('RESOLVED');

        await agentReports(incidentId, fixture.euAgent.id, { pre: HEALTHY, post: HEALTHY });
        await drainRunbookJobs(incidentId, { includeResolution: true });
        for (const job of await verifiedResolutionJobs(execution.id))
          await processRunbookJob(job.payload);
        expect(
          await db.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ status: 'SUCCEEDED', recoveryOutcome: 'ALREADY_CLOSED' });
        const final = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
        expect(final).toMatchObject({ status: 'RESOLVED', resolutionKind: manual.resolutionKind });
        expect(final.resolvedAt).toEqual(manual.resolvedAt);
        expect(await db.incidentEvent.count({ where: { incidentId, type: 'AUTO_RESOLVED' } })).toBe(
          0
        );
      });

      it('keeps the incident open and escalating when verification is unhealthy', async () => {
        const fixture = await createFixture();
        const incidentId = await ingestIncident(fixture);
        await drainRunbookJobs(incidentId);
        const execution = await onlyExecution(incidentId);
        await recoverCheckout(incidentId, fixture.euAgent.id, {
          desired: 3,
          ready: 1,
          observedGeneration: 5,
          generation: 5,
        });
        await drainRunbookJobs(incidentId, { includeResolution: true });
        expect(
          await db.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ recoveryOutcome: 'NOT_VERIFIED' });
        expect(await verifiedResolutionJobs(execution.id)).toHaveLength(0);
        expect(
          await db.incidentEvent.count({ where: { incidentId, type: 'RUNBOOK_UNVERIFIED' } })
        ).toBe(1);
        expect(await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).toMatchObject({
          status: 'OPEN',
          escalationStatus: 'ESCALATING',
        });
        expect(await escalationJob(incidentId, 0)).toMatchObject({ status: 'PENDING' });
      });
    });
  }
);
