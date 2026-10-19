import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  computeDefinitionChecksum,
  computeTriggerFingerprint,
  parseRunbookDefinition,
} from '@/lib/runbooks/definition';
import {
  authorizeUnattendedWrites,
  createServiceBinding,
  revokeUnattendedWrites,
  updateServiceBinding,
} from '@/lib/runbooks/bindings';
import {
  advanceExecution,
  previewRunbookExecution,
  processRunbookJob,
  startRunbookExecution,
  startTriggeredRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import {
  claimAgentAttempt,
  fenceAgentAttempt,
  submitAgentResult,
} from '@/lib/runbooks/agent-claims';
import { claimEscalationStep } from '@/lib/escalation/repository';
import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const statusCheck = (key: string): RunbookStepDefinition => ({
  key,
  name: `Check ${key}`,
  type: 'SYSTEMD',
  riskClass: 'READ_ONLY',
  config: { action: 'status', unit: 'api.service' },
});

const startAction = (overrides: Partial<RunbookStepDefinition> = {}): RunbookStepDefinition => ({
  key: 'start',
  name: 'Start api',
  type: 'SYSTEMD',
  riskClass: 'IDEMPOTENT_WRITE',
  config: { action: 'start', unit: 'api.service' },
  verification: { steps: [statusCheck('verify')] },
  ...overrides,
});

const VERIFIED_RECOVERY: RunbookDefinition = { steps: [startAction()] };

async function publishVersion(runbookId: string, version: number, definition: RunbookDefinition) {
  const parsed = parseRunbookDefinition(definition as unknown as Prisma.InputJsonValue, []);
  return testPrisma.runbookVersion.create({
    data: {
      runbookId,
      version,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
    },
  });
}

async function createFixture(
  definition: RunbookDefinition,
  options: { resolveOnVerifiedRecovery?: boolean; authorize?: boolean } = {}
) {
  const runbook = await testPrisma.runbook.create({
    data: { name: `Recover api ${crypto.randomUUID()}`, slug: `recover-${crypto.randomUUID()}` },
  });
  const version = await publishVersion(runbook.id, 1, definition);
  await testPrisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  const [service, admin, agent] = await Promise.all([
    createTestService('Runbook automation safety'),
    createTestUser({ role: 'ADMIN' }),
    testPrisma.runbookAgent.create({
      data: {
        name: `agent-${crypto.randomUUID()}`,
        status: 'ONLINE',
        capabilities: ['RUNBOOK_SYSTEMD'],
        lastHeartbeatAt: new Date(),
      },
    }),
  ]);
  const pool = await testPrisma.runbookAgentPool.create({
    data: { name: `pool-${crypto.randomUUID()}`, members: { create: { agentId: agent.id } } },
  });
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
      resolveOnVerifiedRecovery: options.resolveOnVerifiedRecovery ?? false,
    },
    admin.id
  );
  const trigger = await testPrisma.runbookTrigger.create({
    data: { bindingId: binding.id, event: 'INCIDENT_CREATED' },
  });
  if (options.authorize)
    binding = await authorizeUnattendedWrites(
      service.id,
      binding.id,
      { expectedVersionId: version.id },
      admin.id
    );
  return { runbook, version, service, admin, agent, pool, binding, trigger };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createEscalatingIncident(serviceId: string) {
  const incident = await createTestIncident('API down', serviceId, {
    escalationStatus: 'ESCALATING',
    currentEscalationStep: 0,
    nextEscalationAt: new Date(Date.now() + 5 * 60_000),
  });
  await testPrisma.backgroundJob.create({
    data: {
      type: 'ESCALATION',
      status: 'PENDING',
      scheduledAt: incident.nextEscalationAt!,
      maxAttempts: 3,
      payload: { incidentId: incident.id, stepIndex: 0, generation: incident.escalationGeneration },
    },
  });
  return incident;
}

async function startAutomatic(
  fixture: Fixture,
  incidentId: string,
  sourceEventId = crypto.randomUUID()
) {
  const runbookVersionId = fixture.binding.runbookVersionId!;
  return startTriggeredRunbookExecution({
    runbookId: fixture.runbook.id,
    runbookVersionId,
    incidentId,
    serviceId: fixture.service.id,
    bindingId: fixture.binding.id,
    triggerId: fixture.trigger.id,
    sourceEventId,
    triggerFingerprint: computeTriggerFingerprint({
      sourceEventId,
      bindingId: fixture.binding.id,
      runbookVersionId,
    }),
  });
}

type Evidence = { serviceState?: string } | null;

/** Simulates the Agent: dispatch the current step, then claim, fence and report it. */
async function runAgentStep(
  executionId: string,
  agentId: string,
  result: { status?: 'SUCCEEDED' | 'FAILED'; pre?: Evidence; post?: Evidence } = {}
) {
  await advanceExecution(executionId);
  const claim = await claimAgentAttempt(agentId);
  expect(claim).not.toBeNull();
  await fenceAgentAttempt({ attemptId: claim!.attemptId, agentId, leaseToken: claim!.leaseToken });
  const capturedAt = new Date().toISOString();
  await submitAgentResult(agentId, {
    attemptId: claim!.attemptId,
    leaseToken: claim!.leaseToken,
    status: result.status ?? 'SUCCEEDED',
    ...(result.status === 'FAILED' ? { errorCode: 'CHECK_FAILED', exitCode: 3 } : {}),
    ...(result.pre ? { preState: { capturedAt, ...result.pre } } : {}),
    ...(result.post ? { postState: { capturedAt, ...result.post } } : {}),
  });
}

/** Restart action recovered the unit and the authored check proved it. */
async function runVerifiedRecovery(executionId: string, agentId: string) {
  await runAgentStep(executionId, agentId, {
    pre: { serviceState: 'inactive' },
    post: { serviceState: 'active' },
  });
  await runAgentStep(executionId, agentId, {
    pre: { serviceState: 'active' },
    post: { serviceState: 'active' },
  });
  await advanceExecution(executionId);
}

async function verifiedResolutionJobs(executionId: string) {
  return testPrisma.backgroundJob.findMany({
    where: {
      type: 'RUNBOOK',
      AND: [
        { payload: { path: ['kind'], equals: 'VERIFIED_RESOLUTION' } },
        { payload: { path: ['executionId'], equals: executionId } },
      ],
    },
  });
}

async function incidentEvents(incidentId: string, type: Prisma.IncidentEventWhereInput['type']) {
  return testPrisma.incidentEvent.findMany({ where: { incidentId, type } });
}

describeIfRealDB(
  'runbook automation safety and verified recovery (real PostgreSQL)',
  { timeout: 180_000 },
  () => {
    beforeEach(async () => resetDatabase(), 240_000);
    afterAll(async () => testPrisma.$disconnect());

    describe('unattended writes', () => {
      it('holds an unauthorized AUTOMATIC write step for approval', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY);
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        expect(execution.unattendedWritesAuthorized).toBe(false);
        const steps = await testPrisma.runbookExecutionStep.findMany({
          where: { executionId: execution.id },
          orderBy: { sequence: 'asc' },
        });
        expect(steps.map(step => [step.stepKey, step.requiresApproval])).toEqual([
          ['start', true],
          ['verify', false],
        ]);
        await advanceExecution(execution.id);
        expect(
          await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ status: 'WAITING_APPROVAL' });
        expect(
          await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: steps[0].id } })
        ).toMatchObject({ status: 'WAITING_APPROVAL' });
        expect(await testPrisma.runbookStepAttempt.count()).toBe(0);
        expect(await incidentEvents(incident.id, 'RUNBOOK_APPROVAL_REQUIRED')).toHaveLength(1);
      });

      it('runs an authorized pinned version unattended and audits the authorization', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, { authorize: true });
        expect(fixture.binding).toMatchObject({
          unattendedWritesVersionId: fixture.version.id,
          unattendedWritesAuthorizedById: fixture.admin.id,
        });
        expect(fixture.binding.unattendedWritesAuthorizedAt).toBeInstanceOf(Date);
        expect(
          await testPrisma.auditLog.count({
            where: { action: 'runbook.binding.unattended_writes.authorized' },
          })
        ).toBe(1);
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        expect(execution.unattendedWritesAuthorized).toBe(true);
        await advanceExecution(execution.id);
        const start = await testPrisma.runbookExecutionStep.findFirstOrThrow({
          where: { executionId: execution.id, stepKey: 'start' },
        });
        expect(start).toMatchObject({ requiresApproval: false, status: 'WAITING_AGENT' });
        expect(
          await testPrisma.runbookStepAttempt.count({ where: { executionStepId: start.id } })
        ).toBe(1);
      });

      it('invalidates authorization when the pinned version or mode changes', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, { authorize: true });
        const next = await publishVersion(fixture.runbook.id, 2, VERIFIED_RECOVERY);
        // Unrelated edits keep the authorization.
        const unchanged = await updateServiceBinding(
          fixture.service.id,
          fixture.binding.id,
          { resolveOnVerifiedRecovery: true },
          fixture.admin.id
        );
        expect(unchanged).toMatchObject({
          resolveOnVerifiedRecovery: true,
          unattendedWritesVersionId: fixture.version.id,
        });
        const repinned = await updateServiceBinding(
          fixture.service.id,
          fixture.binding.id,
          { runbookVersionId: next.id },
          fixture.admin.id
        );
        expect(repinned).toMatchObject({
          runbookVersionId: next.id,
          unattendedWritesVersionId: null,
          unattendedWritesAuthorizedById: null,
          unattendedWritesAuthorizedAt: null,
        });
        const revokedAudit = await testPrisma.auditLog.findFirstOrThrow({
          where: { action: 'runbook.binding.unattended_writes.revoked' },
        });
        expect(revokedAudit.details).toMatchObject({
          metadata: { reason: 'VERSION_CHANGED', automatic: true },
        });

        // A stale review of v1 cannot authorize the newly pinned v2.
        await expect(
          authorizeUnattendedWrites(
            fixture.service.id,
            fixture.binding.id,
            { expectedVersionId: fixture.version.id },
            fixture.admin.id
          )
        ).rejects.toThrow('UNATTENDED_WRITE_VERSION_CHANGED');
        await authorizeUnattendedWrites(
          fixture.service.id,
          fixture.binding.id,
          { expectedVersionId: next.id },
          fixture.admin.id
        );
        const suggested = await updateServiceBinding(
          fixture.service.id,
          fixture.binding.id,
          { mode: 'SUGGESTED' },
          fixture.admin.id
        );
        expect(suggested).toMatchObject({ mode: 'SUGGESTED', unattendedWritesVersionId: null });
        expect(suggested.unattendedWritesAuthorizedAt).toBeNull();
        expect(
          await testPrisma.auditLog.count({
            where: { action: 'runbook.binding.unattended_writes.revoked' },
          })
        ).toBe(2);
        await expect(
          authorizeUnattendedWrites(
            fixture.service.id,
            fixture.binding.id,
            { expectedVersionId: next.id },
            fixture.admin.id
          )
        ).rejects.toThrow('UNATTENDED_WRITE_REQUIRES_AUTOMATIC_PINNED');
      });

      it('revokes authorization explicitly so writes wait for approval again', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, { authorize: true });
        const revoked = await revokeUnattendedWrites(
          fixture.service.id,
          fixture.binding.id,
          fixture.admin.id
        );
        expect(revoked.unattendedWritesAuthorizedAt).toBeNull();
        fixture.binding = revoked;
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        expect(execution.unattendedWritesAuthorized).toBe(false);
        expect(
          await testPrisma.runbookExecutionStep.findFirstOrThrow({
            where: { executionId: execution.id, stepKey: 'start' },
          })
        ).toMatchObject({ requiresApproval: true });
      });

      it('rejects authorization when a write action has no verification', async () => {
        const fixture = await createFixture({ steps: [startAction({ verification: undefined })] });
        await expect(
          authorizeUnattendedWrites(
            fixture.service.id,
            fixture.binding.id,
            { expectedVersionId: fixture.version.id },
            fixture.admin.id
          )
        ).rejects.toThrow('UNATTENDED_WRITE_VERIFICATION_REQUIRED');
        expect(
          (
            await testPrisma.serviceRunbookBinding.findUniqueOrThrow({
              where: { id: fixture.binding.id },
            })
          ).unattendedWritesAuthorizedAt
        ).toBeNull();
      });

      it('keeps NON_IDEMPOTENT actions approval-gated even when authorized', async () => {
        await testPrisma.systemSettings.create({
          data: { id: 'default', runbookAutoNonIdempotentPerIncident: 1 },
        });
        const fixture = await createFixture(
          {
            steps: [
              startAction(),
              startAction({
                key: 'restart',
                name: 'Restart api',
                riskClass: 'NON_IDEMPOTENT',
                config: { action: 'restart', unit: 'api.service' },
                verification: { steps: [statusCheck('verify-restart')] },
              }),
            ],
          },
          { authorize: true }
        );
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        const steps = await testPrisma.runbookExecutionStep.findMany({
          where: { executionId: execution.id },
          orderBy: { sequence: 'asc' },
        });
        expect(steps.map(step => [step.stepKey, step.requiresApproval])).toEqual([
          ['start', false],
          ['verify', false],
          ['restart', true],
          ['verify-restart', false],
        ]);
      });

      it('leaves responder-started executions unaffected', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY);
        const incident = await createEscalatingIncident(fixture.service.id);
        const request = {
          runbookId: fixture.runbook.id,
          bindingId: fixture.binding.id,
          serviceId: fixture.service.id,
          incidentId: incident.id,
          triggeredByUserId: fixture.admin.id,
        };
        const preview = await previewRunbookExecution(request);
        const execution = await startRunbookExecution({
          ...request,
          expectedPlanDigest: preview.digest,
          previewAuthorizationToken: preview.authorizationToken,
        });
        expect(execution.unattendedWritesAuthorized).toBe(false);
        expect(
          await testPrisma.runbookExecutionStep.findFirstOrThrow({
            where: { executionId: execution.id, stepKey: 'start' },
          })
        ).toMatchObject({ requiresApproval: false });
      });

      it('does not let the generic binding update set unattended-write fields', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY);
        for (const field of [
          'unattendedWritesVersionId',
          'unattendedWritesAuthorizedById',
          'unattendedWritesAuthorizedAt',
        ]) {
          await expect(
            updateServiceBinding(
              fixture.service.id,
              fixture.binding.id,
              {
                [field]: field === 'unattendedWritesAuthorizedAt' ? new Date() : fixture.version.id,
              } as never,
              fixture.admin.id
            )
          ).rejects.toThrow();
        }
        expect(
          await testPrisma.serviceRunbookBinding.findUniqueOrThrow({
            where: { id: fixture.binding.id },
          })
        ).toMatchObject({ unattendedWritesVersionId: null, unattendedWritesAuthorizedAt: null });
      });
    });

    describe('verified recovery', () => {
      it('resolves the incident through the lifecycle and cancels pending escalation', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, {
          authorize: true,
          resolveOnVerifiedRecovery: true,
        });
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runVerifiedRecovery(execution.id, fixture.agent.id);

        const completed = await testPrisma.runbookExecution.findUniqueOrThrow({
          where: { id: execution.id },
        });
        expect(completed).toMatchObject({ status: 'SUCCEEDED', recoveryOutcome: 'PENDING' });
        expect(completed.recoveryCheckedAt).toBeNull();
        expect(await incidentEvents(incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(1);
        // The runbook finishing never changes paging on its own.
        expect(
          await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } })
        ).toMatchObject({ status: 'OPEN', escalationStatus: 'ESCALATING' });
        const jobs = await verifiedResolutionJobs(execution.id);
        expect(jobs).toHaveLength(1);

        // A retried job (worker crash after commit) must be a no-op.
        await processRunbookJob(jobs[0].payload);
        await processRunbookJob(jobs[0].payload);

        const resolved = await testPrisma.incident.findUniqueOrThrow({
          where: { id: incident.id },
        });
        expect(resolved).toMatchObject({
          status: 'RESOLVED',
          resolutionKind: 'AUTOMATION',
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        });
        expect(resolved.resolvedAt).toBeInstanceOf(Date);
        const resolutionEvents = await testPrisma.incidentEvent.findMany({
          where: {
            incidentId: incident.id,
            message: { startsWith: 'Resolved after verified recovery' },
          },
        });
        expect(resolutionEvents).toHaveLength(1);
        expect(resolutionEvents[0].message).toBe(
          `Resolved after verified recovery: ${fixture.runbook.name}`
        );
        const final = await testPrisma.runbookExecution.findUniqueOrThrow({
          where: { id: execution.id },
        });
        expect(final.recoveryOutcome).toBe('RESOLVED');
        expect(final.recoveryCheckedAt).toBeInstanceOf(Date);
        expect(
          await claimEscalationStep({
            incidentId: incident.id,
            stepIndex: 0,
            expectedGeneration: resolved.escalationGeneration,
            now: new Date(),
            lockTimeoutMs: 60_000,
          })
        ).toEqual({ claimed: false, reason: 'SUPERSEDED' });
      });

      it('records verification but does not resolve when the toggle is off', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, { authorize: true });
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runVerifiedRecovery(execution.id, fixture.agent.id);
        const completed = await testPrisma.runbookExecution.findUniqueOrThrow({
          where: { id: execution.id },
        });
        expect(completed).toMatchObject({ status: 'SUCCEEDED', recoveryOutcome: 'NOT_REQUESTED' });
        expect(completed.recoveryCheckedAt).toBeInstanceOf(Date);
        expect(await incidentEvents(incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(1);
        expect(await verifiedResolutionJobs(execution.id)).toHaveLength(0);
        expect(
          (await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status
        ).toBe('OPEN');
      });

      it('does not resolve when a succeeded runbook lacks verification proof', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, {
          authorize: true,
          resolveOnVerifiedRecovery: true,
        });
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runAgentStep(execution.id, fixture.agent.id, {
          pre: { serviceState: 'inactive' },
          post: { serviceState: 'active' },
        });
        // The check "succeeds" but reports no post-state evidence.
        await runAgentStep(execution.id, fixture.agent.id);
        await advanceExecution(execution.id);
        expect(
          await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ status: 'SUCCEEDED', recoveryOutcome: 'NOT_VERIFIED' });
        expect(await incidentEvents(incident.id, 'RUNBOOK_UNVERIFIED')).toHaveLength(1);
        expect(await incidentEvents(incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(0);
        expect(await verifiedResolutionJobs(execution.id)).toHaveLength(0);
        expect(
          (await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status
        ).toBe('OPEN');
      });

      it('never resolves from a READ_ONLY-only runbook', async () => {
        const fixture = await createFixture(
          { steps: [statusCheck('inspect')] },
          { resolveOnVerifiedRecovery: true }
        );
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runAgentStep(execution.id, fixture.agent.id, { post: { serviceState: 'active' } });
        await advanceExecution(execution.id);
        expect(
          await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ status: 'SUCCEEDED', recoveryOutcome: 'NOT_REQUESTED' });
        expect(await incidentEvents(incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(0);
        expect(await incidentEvents(incident.id, 'RUNBOOK_UNVERIFIED')).toHaveLength(0);
        expect(await verifiedResolutionJobs(execution.id)).toHaveLength(0);
      });

      it('does not resolve when verification fails the execution', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, {
          authorize: true,
          resolveOnVerifiedRecovery: true,
        });
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runAgentStep(execution.id, fixture.agent.id, {
          pre: { serviceState: 'inactive' },
          post: { serviceState: 'active' },
        });
        await runAgentStep(execution.id, fixture.agent.id, {
          status: 'FAILED',
          post: { serviceState: 'failed' },
        });
        await advanceExecution(execution.id);
        expect(
          await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ status: 'FAILED', recoveryOutcome: 'NOT_VERIFIED' });
        expect(await incidentEvents(incident.id, 'RUNBOOK_UNVERIFIED')).toHaveLength(1);
        expect(await verifiedResolutionJobs(execution.id)).toHaveLength(0);
        expect(
          (await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status
        ).toBe('OPEN');
      });

      it('marks an already-resolved incident as ALREADY_CLOSED', async () => {
        const fixture = await createFixture(VERIFIED_RECOVERY, {
          authorize: true,
          resolveOnVerifiedRecovery: true,
        });
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runVerifiedRecovery(execution.id, fixture.agent.id);
        const resolvedAt = new Date();
        await testPrisma.incident.update({
          where: { id: incident.id },
          data: { status: 'RESOLVED', resolvedAt, resolutionKind: 'MANUAL' },
        });
        const [job] = await verifiedResolutionJobs(execution.id);
        await processRunbookJob(job.payload);
        expect(
          await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
        ).toMatchObject({ recoveryOutcome: 'ALREADY_CLOSED' });
        expect(
          await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } })
        ).toMatchObject({ status: 'RESOLVED', resolutionKind: 'MANUAL', resolvedAt });
      });

      it('blocks resolution on required custom fields and keeps escalating', async () => {
        await testPrisma.customField.create({
          data: {
            name: 'Root cause',
            key: `root_cause_${Date.now()}`,
            type: 'TEXT',
            required: true,
          },
        });
        const fixture = await createFixture(VERIFIED_RECOVERY, {
          authorize: true,
          resolveOnVerifiedRecovery: true,
        });
        const incident = await createEscalatingIncident(fixture.service.id);
        const execution = await startAutomatic(fixture, incident.id);
        await runVerifiedRecovery(execution.id, fixture.agent.id);
        const [job] = await verifiedResolutionJobs(execution.id);
        await processRunbookJob(job.payload);
        await processRunbookJob(job.payload);
        const blocked = await testPrisma.runbookExecution.findUniqueOrThrow({
          where: { id: execution.id },
        });
        expect(blocked.recoveryOutcome).toBe('BLOCKED');
        expect(blocked.recoveryCheckedAt).toBeInstanceOf(Date);
        const skipped = await incidentEvents(incident.id, 'RUNBOOK_SKIPPED');
        expect(skipped).toHaveLength(1);
        expect(skipped[0].message).toContain('Complete required custom fields before resolving');
        const open = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
        expect(open).toMatchObject({ status: 'OPEN', escalationStatus: 'ESCALATING' });
        expect(open.nextEscalationAt).toEqual(incident.nextEscalationAt);
        expect(
          await testPrisma.backgroundJob.count({ where: { type: 'ESCALATION', status: 'PENDING' } })
        ).toBe(1);
        expect(
          await claimEscalationStep({
            incidentId: incident.id,
            stepIndex: 0,
            expectedGeneration: open.escalationGeneration,
            now: new Date(),
            lockTimeoutMs: 60_000,
          })
        ).toMatchObject({ claimed: true });
      });
    });
  }
);
