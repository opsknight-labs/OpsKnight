import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { computeDefinitionChecksum, computePlanDigest, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { createServiceBinding, updateServiceBinding } from '@/lib/runbooks/bindings';
import {
  advanceExecution,
  startRunbookExecution,
  cancelExecution,
  completeStep,
  approveExecutionStep,
} from '@/lib/runbooks/orchestrator';
import {
  claimAgentAttempt,
  fenceAgentAttempt,
  renewAgentAttemptLease,
  submitAgentResult,
  recordAgentHeartbeat,
} from '@/lib/runbooks/agent-claims';
import { consumeEnrollmentToken } from '@/lib/runbooks/agent-auth';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import { evaluateIncidentTriggers } from '@/lib/runbooks/triggers';
import { encrypt } from '@/lib/encryption';
import {
  getExecutionSigningKey,
  stageExecutionSigningKey,
  activateExecutionSigningKey,
  retireExecutionSigningKey,
  signExecutionEnvelope,
} from '@/lib/runbooks/execution-signing';
import { synchronizeLabelMemberships } from '@/lib/runbooks/pool-labels';
import { finalizeVerificationEvidence } from '@/lib/runbooks/verification-evidence';
import { verifyExecutionEnvelope } from '../../agent/src/envelope';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

async function createPublishedRunbook(
  definition: RunbookDefinition,
  inputs?: Array<{
    key: string;
    label: string;
    type?: 'STRING' | 'SECRET_REF' | 'INTEGER' | 'BOOLEAN';
    defaultValue?: string;
    required?: boolean;
    sequence?: number;
  }>
) {
  const parsed = parseRunbookDefinition(definition as unknown as Prisma.InputJsonValue, inputs ?? []);
  const runbook = await testPrisma.runbook.create({
    data: { name: `Safety ${crypto.randomUUID()}`, slug: `safety-${crypto.randomUUID()}` },
  });
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
      inputs: inputs
        ? {
            create: inputs.map(inp => ({
              key: inp.key,
              label: inp.label,
              type: inp.type ?? 'STRING',
              defaultValue: inp.defaultValue,
              required: inp.required ?? false,
              sequence: inp.sequence ?? 0,
            })),
          }
        : undefined,
    },
  });
  await testPrisma.runbookVersion.update({
    where: { id: version.id },
    data: { state: 'PUBLISHED', publishedAt: new Date() },
  });
  await testPrisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  return { runbook, version };
}

async function createAgentTarget(
  definition: RunbookDefinition,
  inputs?: Array<{
    key: string;
    label: string;
    type?: 'STRING' | 'SECRET_REF' | 'INTEGER' | 'BOOLEAN';
    defaultValue?: string;
    required?: boolean;
    sequence?: number;
  }>
) {
  const [{ runbook, version }, service, agent, actor] = await Promise.all([
    createPublishedRunbook(definition, inputs),
    createTestService('Runbook safety'),
    testPrisma.runbookAgent.create({
      data: {
        name: `agent-${crypto.randomUUID()}`,
        status: 'ONLINE',
        capabilities: ['RUNBOOK_SYSTEMD'],
        lastHeartbeatAt: new Date(),
      },
    }),
    createTestUser(),
  ]);
  const pool = await testPrisma.runbookAgentPool.create({
    data: {
      name: `pool-${crypto.randomUUID()}`,
      members: { create: { agentId: agent.id } },
    },
  });
  const binding = await testPrisma.serviceRunbookBinding.create({
    data: {
      serviceId: service.id,
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      defaultAgentPoolId: pool.id,
    },
  });
  return { runbook, version, service, agent, actor, pool, binding };
}

describeIfRealDB('runbook execution safety (real PostgreSQL)', () => {
  beforeEach(async () => resetDatabase(), 30000);
  afterAll(async () => testPrisma.$disconnect());

  it('converts budget exhaustion into one frozen suggestion rather than dropping remediation', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const incident = await createTestIncident('Budget exhausted', target.service.id);
    await testPrisma.systemSettings.create({
      data: { id: 'default', runbookAutoExecutionsPerIncident: 0 },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: {
        mode: 'AUTOMATIC',
        agentSelector: { env: 'prod' },
        triggers: { create: { event: 'INCIDENT_CREATED' } },
      },
    });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { env: 'prod' } },
    });
    expect(await evaluateIncidentTriggers(incident.id, 'budget-event')).toMatchObject({
      matched: 1,
      started: 0,
      suggested: 1,
    });
    await evaluateIncidentTriggers(incident.id, 'budget-event');
    expect(await testPrisma.runbookExecution.count()).toBe(0);
    expect(await testPrisma.runbookSuggestion.count()).toBe(1);
    expect(
      await testPrisma.incidentEvent.count({
        where: { incidentId: incident.id, type: 'RUNBOOK_SUGGESTED' },
      })
    ).toBe(1);
    expect((await testPrisma.runbookSuggestion.findFirstOrThrow()).planSnapshot).toMatchObject({
      agentSelector: { env: 'prod' },
      definitionChecksum: target.version.checksum,
    });
    await testPrisma.systemSettings.update({
      where: { id: 'default' },
      data: { runbookAutoExecutionsPerIncident: 1 },
    });
    expect(await evaluateIncidentTriggers(incident.id, 'already-executed-event')).toMatchObject({
      started: 1,
    });
    expect(await evaluateIncidentTriggers(incident.id, 'already-executed-event')).toMatchObject({
      started: 0,
      suggested: 0,
    });
    expect(await testPrisma.runbookSuggestion.count()).toBe(1);
  });

  it('resolves incident label targeting and fences removal of the pinned source-pool member', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const incident = await createTestIncident('Selector incident', target.service.id);
    await testPrisma.incidentTag.create({
      data: {
        incident: { connect: { id: incident.id } },
        tag: { create: { name: 'host=node-a' } },
      },
    });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { host: 'node-a' } },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { agentSelector: { host: '${{ incident.labels.host }}' } },
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
      incidentId: incident.id,
      triggeredByUserId: target.actor.id,
    });
    expect(execution).toMatchObject({
      resolvedTargetAgentId: target.agent.id,
      resolvedTargetAgentPoolId: null,
    });
    expect(execution.targetSelection).toMatchObject({
      sourcePoolId: target.pool.id,
      selectedAgentId: target.agent.id,
    });
    await advanceExecution(execution.id);
    const claim = (await claimAgentAttempt(target.agent.id))!;
    expect(claim).not.toBeNull();
    await testPrisma.runbookAgentPoolMember.deleteMany({
      where: { agentId: target.agent.id, poolId: target.pool.id },
    });
    await expect(
      fenceAgentAttempt({
        attemptId: claim.attemptId,
        agentId: target.agent.id,
        leaseToken: claim.leaseToken,
      })
    ).rejects.toThrow('source pool');
  });

  it.each(['podman', '${{ inputs.runtime }}'])(
    'never dispatches %s Podman work to a Docker-only Agent',
    async runtime => {
      const inputs =
        runtime !== 'podman'
          ? [
              {
                key: 'runtime',
                label: 'Runtime',
                type: 'STRING' as const,
                defaultValue: 'podman',
                sequence: 0,
              },
            ]
          : undefined;
      const target = await createAgentTarget(
        {
          steps: [
            {
              key: 'inspect',
              name: 'Inspect',
              type: 'DOCKER',
              riskClass: 'READ_ONLY',
              config: { runtime, action: 'inspect', container: 'api' },
            },
          ],
        },
        inputs
      );
      await testPrisma.runbookAgent.update({
        where: { id: target.agent.id },
        data: { capabilities: ['RUNBOOK_DOCKER', 'RUNBOOK_DOCKER_RUNTIME'] },
      });
      const execution = await startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
      });
      await advanceExecution(execution.id);
      expect(await claimAgentAttempt(target.agent.id)).toBeNull();
      await testPrisma.runbookAgent.update({
        where: { id: target.agent.id },
        data: { capabilities: ['RUNBOOK_DOCKER', 'RUNBOOK_PODMAN'] },
      });
      expect(await claimAgentAttempt(target.agent.id)).toMatchObject({
        step: { config: { runtime: 'podman' } },
      });
    }
  );

  it('atomically reserves the per-incident budget under concurrent starts', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const incident = await createTestIncident('Budget concurrency', target.service.id);
    await testPrisma.systemSettings.create({
      data: { id: 'default', runbookAutoExecutionsPerIncident: 1 },
    });
    const input = {
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
      incidentId: incident.id,
    };
    const results = await Promise.allSettled([
      startRunbookExecution(input),
      startRunbookExecution(input),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining('AUTO_REMEDIATION_BUDGET_EXHAUSTED'),
      }),
    });
    expect(await testPrisma.runbookExecution.count({ where: { incidentId: incident.id } })).toBe(1);
    await expect(
      startRunbookExecution({ ...input, triggeredByUserId: target.actor.id })
    ).resolves.toBeDefined();
  });

  it('maintains explicit plus label membership without accepting Agent-authored labels', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const dynamic = await testPrisma.runbookAgentPool.create({
      data: { name: 'Production', matchLabels: { env: 'prod' } },
    });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { env: 'prod' } },
    });
    await testPrisma.$transaction(tx => synchronizeLabelMemberships(tx));
    expect(
      await testPrisma.runbookAgentPoolMember.findUnique({
        where: { poolId_agentId: { poolId: dynamic.id, agentId: target.agent.id } },
      })
    ).toMatchObject({ source: 'DYNAMIC' });
    await recordAgentHeartbeat({
      agentId: target.agent.id,
      version: 'test',
      platform: 'linux',
      labels: { env: 'attacker' },
      capabilities: ['RUNBOOK_SYSTEMD'],
    });
    expect(
      (await testPrisma.runbookAgent.findUniqueOrThrow({ where: { id: target.agent.id } })).labels
    ).toEqual({ env: 'prod' });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { env: 'dev' } },
    });
    await testPrisma.$transaction(tx => synchronizeLabelMemberships(tx));
    expect(await testPrisma.runbookAgentPoolMember.count({ where: { poolId: dynamic.id } })).toBe(
      0
    );
    expect(
      await testPrisma.runbookAgentPoolMember.count({ where: { poolId: target.pool.id } })
    ).toBe(1);
  });

  it('pins exact selector matches and rejects ambiguous local write targeting', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'start',
          name: 'Start',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          requiresApproval: true,
          config: { action: 'start', unit: 'api.service' },
        },
      ],
    });
    await testPrisma.runbookAgentPool.update({
      where: { id: target.pool.id },
      data: { mode: 'LOCAL_HOSTS' },
    });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { host: 'node-a' } },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { agentSelector: { host: 'node-a' } },
    });
    const input = {
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
      triggeredByUserId: target.actor.id,
    };
    expect(await startRunbookExecution(input)).toMatchObject({
      resolvedTargetAgentId: target.agent.id,
    });
    await testPrisma.runbookAgent.create({
      data: {
        name: 'duplicate',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        capabilities: ['RUNBOOK_SYSTEMD'],
        labels: { host: 'node-a' },
        poolMemberships: { create: { poolId: target.pool.id } },
      },
    });
    await expect(startRunbookExecution(input)).rejects.toThrow('TARGET_AMBIGUOUS');
  });

  it('rotates signing identity only after offline fleet acknowledgement and grace', async () => {
    const actor = await createTestUser();
    const old = await getExecutionSigningKey();
    const agent = await testPrisma.runbookAgent.create({
      data: { name: 'offline-agent', status: 'OFFLINE' },
    });
    const next = await stageExecutionSigningKey(actor.id);
    await expect(activateExecutionSigningKey(next.id)).rejects.toThrow('Every enrolled Agent');
    await testPrisma.runbookAgent.update({
      where: { id: agent.id },
      data: { trustedSigningKeys: [old.id, next.id] },
    });
    await activateExecutionSigningKey(next.id);
    expect((await signExecutionEnvelope({ test: true })).signingKeyId).toBe(next.id);
    expect(
      (await testPrisma.runbookExecutionSigningKey.findUniqueOrThrow({ where: { id: old.id } }))
        .state
    ).toBe('RETIRING');
    await expect(retireExecutionSigningKey(old.id)).rejects.toThrow('grace period');
    await testPrisma.runbookExecutionSigningKey.update({
      where: { id: old.id },
      data: { retiredAt: new Date(Date.now() - 1) },
    });
    await retireExecutionSigningKey(old.id);
    expect(
      (await testPrisma.runbookExecutionSigningKey.findUniqueOrThrow({ where: { id: old.id } }))
        .state
    ).toBe('RETIRED');
  });

  it('persists verification proof only with authored successful checks and healthy post-state', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'start',
          name: 'Start',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { action: 'start', unit: 'api.service' },
          verification: {
            steps: [
              {
                key: 'verify',
                name: 'Verify',
                type: 'SYSTEMD',
                riskClass: 'READ_ONLY',
                config: { action: 'status', unit: 'api.service' },
              },
            ],
          },
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
      triggeredByUserId: target.actor.id,
    });
    await testPrisma.runbookExecution.update({
      where: { id: execution.id },
      data: { status: 'SUCCEEDED' },
    });
    await testPrisma.runbookExecutionStep.updateMany({
      where: { executionId: execution.id },
      data: { status: 'SUCCEEDED' },
    });
    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'start' },
    });
    const capturedAt = new Date().toISOString();
    await testPrisma.runbookStepAttempt.create({
      data: {
        executionStepId: step.id,
        claimedAgentId: target.agent.id,
        attemptNumber: 1,
        status: 'SUCCEEDED',
        preState: { capturedAt, serviceState: 'inactive' },
        postState: { capturedAt, serviceState: 'active' },
      },
    });
    const verificationStep = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'verify' },
    });
    await testPrisma.runbookStepAttempt.create({
      data: {
        executionStepId: verificationStep.id,
        claimedAgentId: target.agent.id,
        attemptNumber: 1,
        status: 'SUCCEEDED',
        preState: { capturedAt, serviceState: 'active' },
        postState: { capturedAt, serviceState: 'active' },
      },
    });
    await testPrisma.$transaction(tx => finalizeVerificationEvidence(tx, execution.id));
    expect(
      (await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } }))
        .verificationResult
    ).toMatchObject({ verified: true });
    await testPrisma.runbookExecutionStep.updateMany({
      where: { executionId: execution.id, stepKey: 'verify' },
      data: { status: 'FAILED' },
    });
    await testPrisma.$transaction(tx => finalizeVerificationEvidence(tx, execution.id));
    expect(
      (await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } }))
        .verificationResult
    ).toMatchObject({ verified: false });
  });

  it.each(['precheck', 'verification'] as const)(
    'fails remediation when its %s fails',
    async phase => {
      const check = (key: string) => ({
        key,
        name: key,
        type: 'SYSTEMD' as const,
        riskClass: 'READ_ONLY' as const,
        config: { action: 'status', unit: 'payments.service' },
      });
      const target = await createAgentTarget({
        steps: [
          {
            key: 'restart',
            name: 'Restart service',
            type: 'SYSTEMD',
            riskClass: 'NON_IDEMPOTENT',
            requiresApproval: true,
            config: { action: 'restart', unit: 'payments.service' },
            precheck: { steps: [check('before')] },
            verification: { steps: [check('after')] },
          },
        ],
      });
      const execution = await startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
        triggeredByUserId: target.actor.id,
      });
      const steps = await testPrisma.runbookExecutionStep.findMany({
        where: { executionId: execution.id },
        orderBy: { sequence: 'asc' },
      });
      expect(steps.map(step => step.stepKey)).toEqual(['before', 'restart', 'after']);
      if (phase === 'verification')
        await testPrisma.runbookExecutionStep.updateMany({
          where: { executionId: execution.id, stepKey: { in: ['before', 'restart'] } },
          data: { status: 'SUCCEEDED', completedAt: new Date() },
        });
      await testPrisma.runbookExecutionStep.update({
        where: {
          id: steps.find(step => step.stepKey === (phase === 'precheck' ? 'before' : 'after'))!.id,
        },
        data: { status: 'FAILED', errorCode: 'CHECK_FAILED', completedAt: new Date() },
      });
      await advanceExecution(execution.id);
      expect(
        await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })
      ).toMatchObject({ status: 'FAILED', failureCode: 'CHECK_FAILED' });
      const action = await testPrisma.runbookExecutionStep.findUniqueOrThrow({
        where: { id: steps[1].id },
      });
      expect(action.status).toBe(phase === 'precheck' ? 'PENDING' : 'SUCCEEDED');
      expect(
        await testPrisma.runbookStepAttempt.count({ where: { executionStepId: action.id } })
      ).toBe(0);
    }
  );

  it.each(['NOT_EXISTS', 'NOT_EQUALS'] as const)(
    'suppresses stored invalid AUTOMATIC triggers using %s',
    async operator => {
      const target = await createAgentTarget({
        steps: [
          { key: 'manual', name: 'Manual', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} },
        ],
      });
      await testPrisma.serviceRunbookBinding.update({
        where: { id: target.binding.id },
        data: { mode: 'AUTOMATIC' },
      });
      await testPrisma.runbookTrigger.create({
        data: {
          bindingId: target.binding.id,
          event: 'INCIDENT_CREATED',
          conditions: { create: { field: 'incident.severityTYPO', operator, value: 'P1' } },
        },
      });
      const incident = await createTestIncident(
        'Invalid trigger must not start',
        target.service.id
      );
      const result = await evaluateIncidentTriggers(incident.id, `typo-${operator}`);
      expect(result).toMatchObject({ matched: 0, started: 0, suppressed: 1 });
      expect(await testPrisma.runbookExecution.count()).toBe(0);
    }
  );

  it.each(['P1', 'P3'])(
    'evaluates live incident priority %s and gates following steps',
    async priority => {
      const target = await createAgentTarget({
        steps: [
          {
            key: 'gate',
            name: 'Priority gate',
            type: 'CONDITION',
            riskClass: 'READ_ONLY',
            config: { field: 'incident.priority', operator: 'EQUALS', value: 'P1' },
          },
          {
            key: 'inspect',
            name: 'Inspect service',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: { action: 'status', unit: 'api.service' },
          },
        ],
      });
      const incident = await createTestIncident('Condition context', target.service.id, {
        priority,
      });
      const execution = await startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
        incidentId: incident.id,
      });
      await advanceExecution(execution.id);
      await advanceExecution(execution.id);
      const steps = await testPrisma.runbookExecutionStep.findMany({
        where: { executionId: execution.id },
        orderBy: { sequence: 'asc' },
      });
      expect(steps[0].status).toBe(priority === 'P1' ? 'SUCCEEDED' : 'SKIPPED');
      expect(steps[1].status).toBe(priority === 'P1' ? 'WAITING_AGENT' : 'SKIPPED');
      expect(
        await testPrisma.runbookStepAttempt.count({ where: { executionStepId: steps[1].id } })
      ).toBe(priority === 'P1' ? 1 : 0);
    }
  );

  it('claims public work after more than fifty transport-blocked secret attempts', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'inspect',
          name: 'Inspect',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);
    const publicAttempt = await testPrisma.runbookStepAttempt.findFirstOrThrow({
      where: { executionStep: { executionId: execution.id } },
    });
    await testPrisma.runbookStepAttempt.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        executionStepId: publicAttempt.executionStepId,
        attemptNumber: index + 2,
        targetAgentPoolId: target.pool.id,
        status: 'PENDING' as const,
        requiresConfidentialTransport: true,
        claimDeadlineAt: new Date(Date.now() + 300000),
        createdAt: new Date(publicAttempt.createdAt.getTime() - 1000 - index),
      })),
    });
    expect((await claimAgentAttempt(target.agent.id))?.attemptId).toBe(publicAttempt.id);
    expect(
      await testPrisma.runbookStepAttempt.count({
        where: { requiresConfidentialTransport: true, status: 'PENDING' },
      })
    ).toBe(51);
  });

  it('rejects ambiguous local-host write targets during binding creation and update', async () => {
    const target = await createAgentTarget({
      description: 'Binding validation',
      steps: [
        {
          key: 'start',
          name: 'Start',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { action: 'start', unit: 'api.service' },
        },
      ],
    });
    const second = await testPrisma.runbookAgent.create({
      data: { name: 'Second machine', status: 'ONLINE' },
    });
    await testPrisma.runbookAgentPool.update({
      where: { id: target.pool.id },
      data: { mode: 'LOCAL_HOSTS', members: { create: { agentId: second.id } } },
    });
    await expect(
      updateServiceBinding(
        target.service.id,
        target.binding.id,
        { defaultAgentPoolId: target.pool.id },
        target.actor.id
      )
    ).rejects.toThrow('This LOCAL_HOSTS pool contains 2 Agents');
    const service = await createTestService('Binding guard');
    await expect(
      createServiceBinding(
        service.id,
        {
          runbookId: target.runbook.id,
          runbookVersionId: target.version.id,
          versionStrategy: 'PINNED',
          enabled: true,
          mode: 'MANUAL',
          defaultAgentPoolId: target.pool.id,
          inputValues: {},
        },
        target.actor.id
      )
    ).rejects.toThrow('Machine-specific write actions require a specific Agent');
    await expect(
      updateServiceBinding(
        target.service.id,
        target.binding.id,
        { defaultAgentPoolId: null, defaultAgentId: target.agent.id },
        target.actor.id
      )
    ).resolves.toHaveProperty('defaultAgentId', target.agent.id);
  });

  it('keeps quarantined Agents degraded and rejects invalid enrollment keys before consuming tokens', async () => {
    const agent = await testPrisma.runbookAgent.create({
      data: { name: 'Quarantine', status: 'ONLINE' },
    });
    await recordAgentHeartbeat({
      agentId: agent.id,
      version: '2.0.0',
      platform: 'linux',
      spoolDepth: 0,
      deadLetterDepth: 1,
    });
    expect(
      (await testPrisma.runbookAgent.findUniqueOrThrow({ where: { id: agent.id } })).status
    ).toBe('DEGRADED');
    await expect(
      consumeEnrollmentToken({
        token: 'unused',
        publicKey: '-----BEGIN PUBLIC KEY-----invalid',
        version: '2.0.0',
        platform: 'linux',
      })
    ).rejects.toThrow('A PEM public signing key is required.');
    const wrongKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    await expect(
      consumeEnrollmentToken({
        token: 'unused',
        publicKey: wrongKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        version: '2.0.0',
        platform: 'linux',
      })
    ).rejects.toThrow('A PEM public signing key is required.');
  });

  it('rejects ambiguous writes to multi-member local-host pools but permits shared targets', async () => {
    const target = await createAgentTarget({
      description: 'Host targeting',
      steps: [
        {
          key: 'restart',
          name: 'Restart',
          type: 'SYSTEMD',
          riskClass: 'NON_IDEMPOTENT',
          config: { action: 'restart', unit: 'api.service' },
        },
      ],
    });
    const second = await testPrisma.runbookAgent.create({
      data: { name: 'Other host', status: 'ONLINE' },
    });
    await testPrisma.runbookAgentPool.update({
      where: { id: target.pool.id },
      data: { mode: 'LOCAL_HOSTS', members: { create: { agentId: second.id } } },
    });
    const start = {
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
      triggeredByUserId: target.actor.id,
    };
    await expect(startRunbookExecution(start)).rejects.toThrow(/AMBIGUOUS_HOST_TARGET/);
    await testPrisma.runbookAgentPool.update({
      where: { id: target.pool.id },
      data: { mode: 'SHARED_TARGET' },
    });
    await expect(startRunbookExecution(start)).resolves.toHaveProperty('id');
  });

  it('skips locked pending attempts instead of blocking other Agents', async () => {
    const target = await createAgentTarget({
      description: 'Skip locked',
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const attemptIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const execution = await startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
        triggerFingerprint: `skip-${index}`,
      });
      await advanceExecution(execution.id);
      attemptIds.push(
        (
          await testPrisma.runbookStepAttempt.findFirstOrThrow({
            where: { executionStep: { executionId: execution.id } },
          })
        ).id
      );
    }
    await testPrisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "RunbookStepAttempt" WHERE "id" = ${attemptIds[0]} FOR UPDATE`;
      expect((await claimAgentAttempt(target.agent.id))?.attemptId).toBe(attemptIds[1]);
    });
    expect((await claimAgentAttempt(target.agent.id))?.attemptId).toBe(attemptIds[0]);
  });

  it('rechecks local-host membership at claim and start', async () => {
    const target = await createAgentTarget({
      description: 'Changing hosts',
      steps: [
        {
          key: 'start',
          name: 'Start',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { action: 'start', unit: 'api.service' },
        },
      ],
    });
    await testPrisma.runbookAgentPool.update({
      where: { id: target.pool.id },
      data: { mode: 'LOCAL_HOSTS' },
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);
    const second = await testPrisma.runbookAgent.create({
      data: { name: 'Joined host', status: 'ONLINE' },
    });
    const membership = await testPrisma.runbookAgentPoolMember.create({
      data: { poolId: target.pool.id, agentId: second.id },
    });
    expect(await claimAgentAttempt(target.agent.id)).toBeNull();
    await testPrisma.runbookAgentPoolMember.delete({ where: { id: membership.id } });
    const claim = (await claimAgentAttempt(target.agent.id))!;
    await testPrisma.runbookAgentPoolMember.create({
      data: { poolId: target.pool.id, agentId: second.id },
    });
    await expect(
      fenceAgentAttempt({
        attemptId: claim.attemptId,
        agentId: target.agent.id,
        leaseToken: claim.leaseToken,
      })
    ).rejects.toThrow();
    expect(
      (await testPrisma.runbookStepAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } }))
        .status
    ).toBe('CLAIMED');
  });

  it('creates one execution signing identity under concurrent initialization', async () => {
    const keys = await Promise.all([
      getExecutionSigningKey(),
      getExecutionSigningKey(),
      getExecutionSigningKey(),
    ]);
    expect(new Set(keys.map(key => key.publicKey)).size).toBe(1);
    expect(await testPrisma.runbookExecutionSigningKey.count()).toBe(1);
    expect(keys[0].privateKeyEncrypted).not.toContain('PRIVATE KEY');
  });

  it('acknowledges repeated starts for the same fence without extending authority', async () => {
    const target = await createAgentTarget({
      description: 'Start retries',
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);
    const claim = (await claimAgentAttempt(target.agent.id))!;
    const key = await getExecutionSigningKey();
    expect(() => verifyExecutionEnvelope(claim, key.publicKey, target.agent.id)).not.toThrow();
    const fence = {
      attemptId: claim.attemptId,
      agentId: target.agent.id,
      leaseToken: claim.leaseToken,
    };
    const [first, second] = await Promise.all([fenceAgentAttempt(fence), fenceAgentAttempt(fence)]);
    expect([first.alreadyStarted, second.alreadyStarted].sort()).toEqual([false, true]);
    expect(first.startedAt).toBe(second.startedAt);
    expect(first.leaseExpiresAt).toBe(second.leaseExpiresAt);
    await expect(fenceAgentAttempt({ ...fence, leaseToken: 'incorrect' })).rejects.toThrow();
  });

  it('isolates a bad automatic binding from later valid Runbooks', async () => {
    const service = await createTestService('Trigger isolation');
    const incident = await createTestIncident('Trigger isolation', service.id);
    for (const needsAgent of [true, false]) {
      const { runbook, version } = await createPublishedRunbook({
        description: 'Trigger',
        steps: needsAgent
          ? [
              {
                key: 'status',
                name: 'Status',
                type: 'SYSTEMD',
                riskClass: 'READ_ONLY',
                config: { action: 'status', unit: 'api.service' },
              },
            ]
          : [
              {
                key: 'wait',
                name: 'Wait',
                type: 'WAIT',
                riskClass: 'READ_ONLY',
                config: { durationSeconds: 0 },
              },
            ],
      });
      await testPrisma.serviceRunbookBinding.create({
        data: {
          serviceId: service.id,
          runbookId: runbook.id,
          runbookVersionId: version.id,
          versionStrategy: 'PINNED',
          mode: 'AUTOMATIC',
          triggers: { create: { event: 'INCIDENT_CREATED' } },
        },
      });
    }
    expect(await evaluateIncidentTriggers(incident.id, 'isolation-event')).toMatchObject({
      matched: 2,
      started: 1,
      suppressed: 1,
    });
    expect(await testPrisma.runbookExecution.count({ where: { incidentId: incident.id } })).toBe(1);
    expect(
      await testPrisma.incidentEvent.count({
        where: { incidentId: incident.id, type: 'RUNBOOK_FAILED' },
      })
    ).toBe(1);
  });

  it('delivers only inputs and secrets referenced by the claimed step', async () => {
    const target = await createAgentTarget(
      {
        description: 'Step secrets',
        steps: [
          {
            key: 'status',
            name: 'Status',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: {
              action: 'status',
              unit: 'api.service',
              environment: { TOKEN: '${{ inputs.unit }}' },
            },
          },
        ],
      },
      [
        {
          key: 'unit',
          label: 'Unit',
          type: 'SECRET_REF',
          required: true,
        },
        {
          key: 'unused',
          label: 'Unused token',
          type: 'SECRET_REF',
          required: true,
        },
      ]
    );
    await testPrisma.runbookSecret.create({
      data: {
        name: 'unit-secret',
        valueEncrypted: await encrypt('api.service'),
        createdById: target.actor.id,
        grants: { create: { agentPoolId: target.pool.id } },
      },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { inputValues: { unit: 'secret://unit-secret', unused: 'secret://not-granted' } },
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);
    await expect(claimAgentAttempt(target.agent.id)).rejects.toThrow(
      'HTTPS required for secret-backed steps'
    );
    expect(
      await testPrisma.runbookStepAttempt.findFirst({
        where: { executionStep: { executionId: execution.id } },
        select: { requiresConfidentialTransport: true },
      })
    ).toEqual({ requiresConfidentialTransport: true });
    const secureClaim = await claimAgentAttempt(target.agent.id, true);
    expect(secureClaim?.inputValues).toEqual({ unit: 'api.service' });
    expect(secureClaim?.secretInputKeys).toEqual(['unit']);
  });

  it('rejects a published definition with a corrupted checksum', async () => {
    const target = await createAgentTarget({
      description: 'Checksum',
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    });
    const corrupted = await testPrisma.runbookVersion.create({
      data: {
        runbookId: target.runbook.id,
        version: 2,
        state: 'PUBLISHED',
        definition: target.version.definition as Prisma.InputJsonValue,
        checksum: '0'.repeat(64),
      },
    });
    await testPrisma.runbook.update({
      where: { id: target.runbook.id },
      data: { publishedVersionId: corrupted.id },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { versionStrategy: 'LATEST_PUBLISHED', runbookVersionId: null },
    });
    await expect(
      startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
      })
    ).rejects.toThrow(/checksum/);
  });

  it('counts pending write steps in the Agent-pool concurrency guard', async () => {
    const definition: RunbookDefinition = {
      description: 'Pool write limit',
      steps: [
        {
          key: 'restart',
          name: 'Restart service',
          type: 'SYSTEMD',
          riskClass: 'NON_IDEMPOTENT',
          config: { action: 'restart', unit: 'api.service' },
        },
      ],
    };
    const target = await createAgentTarget(definition);
    for (let index = 0; index < 5; index++) {
      await startRunbookExecution({
        runbookId: target.runbook.id,
        runbookVersionId: target.version.id,
        serviceId: target.service.id,
        bindingId: target.binding.id,
        triggeredByUserId: target.actor.id,
        triggerFingerprint: `pool-write-${index}`,
      });
    }
    await expect(
      startRunbookExecution({
        runbookId: target.runbook.id,
        runbookVersionId: target.version.id,
        serviceId: target.service.id,
        bindingId: target.binding.id,
        triggeredByUserId: target.actor.id,
        triggerFingerprint: 'pool-write-over-limit',
      })
    ).rejects.toThrow(/AGENT_POOL_CONCURRENCY_LIMIT/);
  });

  it('allows only one Agent claim for a pending attempt', async () => {
    const definition: RunbookDefinition = {
      description: 'Claim fencing',
      steps: [
        {
          key: 'status',
          name: 'Service status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    };
    const target = await createAgentTarget(definition);
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      serviceId: target.service.id,
      bindingId: target.binding.id,
    });
    await advanceExecution(execution.id);

    const claims = await Promise.all([
      claimAgentAttempt(target.agent.id),
      claimAgentAttempt(target.agent.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await testPrisma.runbookStepAttempt.count({ where: { status: 'CLAIMED' } })).toBe(1);
  });

  it('does not duplicate dispatch when two workers advance the same execution', async () => {
    const definition: RunbookDefinition = {
      description: 'Advance fencing',
      steps: [
        {
          key: 'status',
          name: 'Service status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    };
    const target = await createAgentTarget(definition);
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      serviceId: target.service.id,
      bindingId: target.binding.id,
    });

    await Promise.all([advanceExecution(execution.id), advanceExecution(execution.id)]);
    expect(
      await testPrisma.runbookStepAttempt.count({
        where: { executionStep: { executionId: execution.id } },
      })
    ).toBe(1);
  });

  it('executes a retired version only through its existing pinned binding', async () => {
    const definition: RunbookDefinition = {
      description: 'Pinned retirement',
      steps: [
        {
          key: 'status',
          name: 'Service status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    };
    const target = await createAgentTarget(definition);
    await testPrisma.runbookVersion.update({
      where: { id: target.version.id },
      data: { state: 'RETIRED' },
    });

    await expect(
      startRunbookExecution({
        runbookId: target.runbook.id,
        runbookVersionId: target.version.id,
        serviceId: target.service.id,
        bindingId: target.binding.id,
      })
    ).resolves.toMatchObject({ runbookVersionId: target.version.id });
    await expect(
      startRunbookExecution({
        runbookId: target.runbook.id,
        runbookVersionId: target.version.id,
        serviceId: target.service.id,
      })
    ).rejects.toThrow(/retired version/);
  });

  it('reconciles a fenced spooled result produced before lease expiry', async () => {
    const definition: RunbookDefinition = {
      description: 'Late result recovery',
      steps: [
        {
          key: 'start',
          name: 'Start service',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { action: 'start', unit: 'api.service' },
        },
      ],
    };
    const target = await createAgentTarget(definition);
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      serviceId: target.service.id,
      bindingId: target.binding.id,
    });
    await advanceExecution(execution.id);
    const claim = await claimAgentAttempt(target.agent.id);
    expect(claim).not.toBeNull();
    await fenceAgentAttempt({
      attemptId: claim!.attemptId,
      agentId: target.agent.id,
      leaseToken: claim!.leaseToken,
    });

    const producedAt = new Date(Date.now() - 2_000);
    await testPrisma.runbookStepAttempt.update({
      where: { id: claim!.attemptId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    await reconcileRunbooks();
    expect(
      await testPrisma.runbookStepAttempt.findUnique({
        where: { id: claim!.attemptId },
        select: { leaseToken: true, leaseExpiresAt: true },
      })
    ).toMatchObject({
      leaseToken: expect.any(String),
      leaseExpiresAt: expect.any(Date),
    });
    await advanceExecution(execution.id);
    expect(
      await testPrisma.runbookExecution.findUnique({
        where: { id: execution.id },
        select: { status: true, failureCode: true },
      })
    ).toMatchObject({ status: 'FAILED', failureCode: 'UNKNOWN_OUTCOME' });
    const result = await submitAgentResult(target.agent.id, {
      attemptId: claim!.attemptId,
      leaseToken: claim!.leaseToken,
      producedAt: producedAt.toISOString(),
      status: 'SUCCEEDED',
      exitCode: 0,
      outputPreview: 'service restarted',
    });

    expect(result).toMatchObject({ accepted: true, reconciledLate: true });
    expect(
      await testPrisma.runbookExecutionStep.findFirst({
        where: { executionId: execution.id },
        select: { status: true },
      })
    ).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('rejects a resolved target that becomes option-like after interpolation', async () => {
    const definition: RunbookDefinition = {
      description: 'Resolved target validation',
      steps: [
        {
          key: 'status',
          name: 'Service status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: '${{ inputs.unit }}' },
        },
      ],
    };
    const target = await createAgentTarget(definition, [
      {
        key: 'unit',
        label: 'Unit',
        type: 'STRING',
        required: true,
      },
    ]);
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { inputValues: { unit: '--system' } },
    });
    await expect(
      startRunbookExecution({
        runbookId: target.runbook.id,
        serviceId: target.service.id,
        bindingId: target.binding.id,
      })
    ).rejects.toThrow(/invalid systemd unit/);
  });

  it('rejects Agent start after the execution deadline and after Agent revocation', async () => {
    const definition: RunbookDefinition = {
      description: 'Start fence',
      steps: [
        {
          key: 'status',
          name: 'Service status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    };
    const expired = await createAgentTarget(definition);
    const expiredExecution = await startRunbookExecution({
      runbookId: expired.runbook.id,
      serviceId: expired.service.id,
      bindingId: expired.binding.id,
    });
    await advanceExecution(expiredExecution.id);
    const expiredClaim = await claimAgentAttempt(expired.agent.id);
    await testPrisma.runbookExecution.update({
      where: { id: expiredExecution.id },
      data: { deadlineAt: new Date(Date.now() - 1) },
    });
    await expect(
      fenceAgentAttempt({
        attemptId: expiredClaim!.attemptId,
        agentId: expired.agent.id,
        leaseToken: expiredClaim!.leaseToken,
      })
    ).rejects.toThrow(/state changed/);

    const revoked = await createAgentTarget(definition);
    const revokedExecution = await startRunbookExecution({
      runbookId: revoked.runbook.id,
      serviceId: revoked.service.id,
      bindingId: revoked.binding.id,
    });
    await advanceExecution(revokedExecution.id);
    const revokedClaim = await claimAgentAttempt(revoked.agent.id);
    await testPrisma.runbookAgent.update({
      where: { id: revoked.agent.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await expect(
      fenceAgentAttempt({
        attemptId: revokedClaim!.attemptId,
        agentId: revoked.agent.id,
        leaseToken: revokedClaim!.leaseToken,
      })
    ).rejects.toThrow(/state changed/);
  });

  it('starts the exact suggested version after a newer version is published', async () => {
    const definition: RunbookDefinition = {
      description: 'Suggestion v1',
      steps: [
        {
          key: 'status',
          name: 'Service status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    };
    const target = await createAgentTarget(definition);
    const incident = await createTestIncident('Suggested runbook', target.service.id);
    const trigger = await testPrisma.runbookTrigger.create({
      data: { bindingId: target.binding.id, event: 'INCIDENT_CREATED' },
    });
    const suggestion = await testPrisma.runbookSuggestion.create({
      data: {
        incidentId: incident.id,
        bindingId: target.binding.id,
        runbookVersionId: target.version.id,
        triggerId: trigger.id,
        sourceEventId: 'incident-created-v1',
        fingerprint: 'suggestion-v1',
        planSnapshot: {
          inputValues: {},
          agentId: null,
          agentPoolId: target.pool.id,
          definitionChecksum: target.version.checksum,
        },
      },
    });
    const version2 = await testPrisma.runbookVersion.create({
      data: {
        runbookId: target.runbook.id,
        version: 2,
        state: 'PUBLISHED',
        definition: definition as unknown as Prisma.InputJsonValue,
        checksum: `${target.version.checksum.slice(0, 63)}2`,
        publishedAt: new Date(),
      },
    });
    await testPrisma.$transaction([
      testPrisma.runbookVersion.update({
        where: { id: target.version.id },
        data: { state: 'RETIRED' },
      }),
      testPrisma.runbook.update({
        where: { id: target.runbook.id },
        data: { publishedVersionId: version2.id },
      }),
      testPrisma.serviceRunbookBinding.update({
        where: { id: target.binding.id },
        data: {
          versionStrategy: 'LATEST_PUBLISHED',
          runbookVersionId: null,
          inputValues: { changed: 'must-not-be-used' },
          defaultAgentPoolId: null,
          defaultAgentId: target.agent.id,
        },
      }),
    ]);

    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      runbookVersionId: suggestion.runbookVersionId,
      suggestionId: suggestion.id,
      incidentId: incident.id,
      serviceId: target.service.id,
      bindingId: target.binding.id,
      triggeredByUserId: target.actor.id,
    });
    expect(execution.runbookVersionId).toBe(target.version.id);
    expect(execution.inputValues).toEqual({});
    expect(execution.resolvedTargetAgentPoolId).toBe(target.pool.id);
    expect(execution.resolvedTargetAgentId).toBeNull();
    expect(execution.triggerId).toBe(trigger.id);
    expect(
      await testPrisma.runbookSuggestion.findUnique({
        where: { id: suggestion.id },
        select: { state: true },
      })
    ).toMatchObject({ state: 'STARTED' });
  });

  it('deduplicates simultaneous trigger starts by fingerprint', async () => {
    const definition: RunbookDefinition = {
      description: 'Trigger dedupe',
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
    const { runbook } = await createPublishedRunbook(definition);
    const starts = await Promise.allSettled([
      startRunbookExecution({ runbookId: runbook.id, triggerFingerprint: 'same-event' }),
      startRunbookExecution({ runbookId: runbook.id, triggerFingerprint: 'same-event' }),
    ]);
    expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await testPrisma.runbookExecution.count({ where: { triggerFingerprint: 'same-event' } })
    ).toBe(1);
  });

  it.each(['LOCAL_HOSTS', 'SHARED_TARGET'] as const)(
    'preserves %s targeting during safe read retries',
    async mode => {
      const target = await createAgentTarget({
        description: 'Safe retry',
        steps: [
          {
            key: 'status',
            name: 'Status',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: { action: 'status', unit: 'api.service' },
            maxRetries: 1,
          },
        ],
      });
      await testPrisma.runbookAgentPool.update({ where: { id: target.pool.id }, data: { mode } });
      const execution = await startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
      });
      await advanceExecution(execution.id);
      const claim = (await claimAgentAttempt(target.agent.id))!;
      await fenceAgentAttempt({
        attemptId: claim.attemptId,
        agentId: target.agent.id,
        leaseToken: claim.leaseToken,
      });
      await submitAgentResult(target.agent.id, {
        attemptId: claim.attemptId,
        leaseToken: claim.leaseToken,
        status: 'FAILED',
        errorCode: 'COMMAND_FAILED',
      });
      const retry = await testPrisma.runbookStepAttempt.findFirstOrThrow({
        where: { executionStep: { executionId: execution.id }, attemptNumber: 2 },
      });
      expect(retry.targetAgentId).toBe(mode === 'LOCAL_HOSTS' ? target.agent.id : null);
      expect(retry.targetAgentPoolId).toBe(mode === 'SHARED_TARGET' ? target.pool.id : null);
    }
  );

  it('keeps a started write timeout UNKNOWN without creating another attempt', async () => {
    const target = await createAgentTarget({
      description: 'Write timeout',
      steps: [
        {
          key: 'start',
          name: 'Start',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { action: 'start', unit: 'api.service' },
          maxRetries: 2,
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);
    const claim = (await claimAgentAttempt(target.agent.id))!;
    await fenceAgentAttempt({
      attemptId: claim.attemptId,
      agentId: target.agent.id,
      leaseToken: claim.leaseToken,
    });
    expect(
      await submitAgentResult(target.agent.id, {
        attemptId: claim.attemptId,
        leaseToken: claim.leaseToken,
        status: 'FAILED',
        errorCode: 'COMMAND_TIMEOUT',
      })
    ).toMatchObject({ status: 'UNKNOWN' });
    expect(
      await testPrisma.runbookStepAttempt.count({
        where: { executionStep: { executionId: execution.id } },
      })
    ).toBe(1);
  });

  it.each(['cancel', 'deadline', 'revoke'] as const)(
    'enforces %s while the Agent is executing',
    async reason => {
      const target = await createAgentTarget({
        description: 'Active fence',
        steps: [
          {
            key: 'status',
            name: 'Status',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: { action: 'status', unit: 'api.service' },
          },
        ],
      });
      const execution = await startRunbookExecution({
        runbookId: target.runbook.id,
        bindingId: target.binding.id,
        serviceId: target.service.id,
      });
      await advanceExecution(execution.id);
      const claim = (await claimAgentAttempt(target.agent.id))!;
      const fence = {
        attemptId: claim.attemptId,
        agentId: target.agent.id,
        leaseToken: claim.leaseToken,
      };
      await fenceAgentAttempt(fence);
      if (reason === 'revoke') {
        await testPrisma.runbookAgent.update({
          where: { id: target.agent.id },
          data: { status: 'REVOKED' },
        });
        await expect(
          submitAgentResult(target.agent.id, { ...fence, status: 'SUCCEEDED' })
        ).rejects.toThrow();
      } else {
        await testPrisma.runbookExecution.update({
          where: { id: execution.id },
          data:
            reason === 'cancel'
              ? { cancelRequestedAt: new Date() }
              : { deadlineAt: new Date(Date.now() - 1) },
        });
        expect(await renewAgentAttemptLease(fence)).toMatchObject({ cancelRequested: true });
        await expect(
          submitAgentResult(target.agent.id, { ...fence, status: 'SUCCEEDED' })
        ).rejects.toThrow();
      }
    }
  );

  async function assertTerminalExecutionInvariants(executionId: string) {
    const execution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: executionId },
      include: { steps: { include: { attempts: true } } },
    });
    expect(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN']).toContain(execution.status);
    for (const step of execution.steps) {
      expect(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'SKIPPED', 'UNKNOWN']).toContain(
        step.status
      );
      expect(['PENDING', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL']).not.toContain(
        step.status
      );
      for (const attempt of step.attempts) {
        expect(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN']).toContain(attempt.status);
        expect(['PENDING', 'CLAIMED', 'RUNNING']).not.toContain(attempt.status);
      }
    }
  }

  it('enforces terminal parent invariant: in-flight local WAIT cancelled terminates step and parent without leaving running steps', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'wait_step',
          name: 'Wait step',
          type: 'WAIT',
          riskClass: 'READ_ONLY',
          config: { seconds: 120 },
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);

    const runningStep = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'wait_step' },
    });
    expect(runningStep.status).toBe('RUNNING');

    await cancelExecution(execution.id, target.actor.id, 'operator cancelled');
    await advanceExecution(execution.id);

    const cancelledExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(cancelledExecution.status).toBe('CANCELLED');

    const cancelledStep = await testPrisma.runbookExecutionStep.findUniqueOrThrow({
      where: { id: runningStep.id },
    });
    expect(cancelledStep.status).toBe('CANCELLED');

    await assertTerminalExecutionInvariants(execution.id);
  });

  it('enforces terminal parent invariant: in-flight local write HTTP cancelled transitions step to UNKNOWN and parent to CANCELLED', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'http_write',
          name: 'HTTP Write Step',
          type: 'HTTP',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { url: 'https://example.com/api/deploy', method: 'PUT' },
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });

    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'http_write' },
    });
    await testPrisma.runbookExecutionStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    await cancelExecution(execution.id, target.actor.id, 'operator cancelled');
    await advanceExecution(execution.id);

    const cancelledExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(cancelledExecution.status).toBe('CANCELLED');

    const updatedStep = await testPrisma.runbookExecutionStep.findUniqueOrThrow({
      where: { id: step.id },
    });
    expect(updatedStep.status).toBe('UNKNOWN');
    expect(updatedStep.errorCode).toBe('CANCELLED_WITH_UNKNOWN_OUTCOME');

    await assertTerminalExecutionInvariants(execution.id);
  });

  it('completeStep does not resurrect cancelled execution and rolls back step completion', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'step1',
          name: 'Step 1',
          type: 'MANUAL',
          riskClass: 'READ_ONLY',
          config: {},
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'step1' },
    });

    await cancelExecution(execution.id, target.actor.id);
    await advanceExecution(execution.id);

    await completeStep(execution.id, step.id, 'SUCCEEDED', 'late output');

    const finalExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(finalExecution.status).toBe('CANCELLED');

    const finalStep = await testPrisma.runbookExecutionStep.findUniqueOrThrow({
      where: { id: step.id },
    });
    expect(finalStep.status).toBe('CANCELLED');

    await assertTerminalExecutionInvariants(execution.id);
  });

  it('approveExecutionStep rolls back if execution was cancelled concurrently', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'action',
          name: 'Action',
          type: 'MANUAL',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: {},
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);

    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'action' },
    });
    expect(step.status).toBe('WAITING_APPROVAL');

    await cancelExecution(execution.id, target.actor.id);
    await advanceExecution(execution.id);

    await expect(
      approveExecutionStep({
        executionId: execution.id,
        stepId: step.id,
        planDigest: 'manual:action',
        actorId: target.actor.id,
      })
    ).rejects.toThrow();

    await assertTerminalExecutionInvariants(execution.id);
  });

  it('permits a sequential workflow with more write steps than pool concurrency limit', async () => {
    const target = await createAgentTarget({
      description: 'Multi-write sequential workflow',
      steps: Array.from({ length: 6 }, (_, i) => ({
        key: `step_${i}`,
        name: `Step ${i}`,
        type: 'SYSTEMD' as const,
        riskClass: 'NON_IDEMPOTENT' as const,
        config: { action: 'restart', unit: `service-${i}.service` },
      })),
    });

    // MAX_CONCURRENT_WRITE_ACTIONS_PER_POOL is 5.
    // A single sequential runbook with 6 write steps must be admitted because at most 1 step executes at a time.
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      runbookVersionId: target.version.id,
      serviceId: target.service.id,
      bindingId: target.binding.id,
      triggeredByUserId: target.actor.id,
      triggerFingerprint: 'sequential-write-multi-step',
    });
    expect(execution.status).toBe('QUEUED');
  });

  it('concurrent race: overlapping completeStep and cancelExecution preserve terminal parent and step invariants', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'step1',
          name: 'Step 1',
          type: 'MANUAL',
          riskClass: 'READ_ONLY',
          config: {},
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'step1' },
    });

    // Advance execution and put step into RUNNING to test genuine race on an in-flight active step
    await testPrisma.runbookExecution.update({
      where: { id: execution.id },
      data: { status: 'RUNNING' },
    });
    await testPrisma.runbookExecutionStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // Fire completeStep and cancelExecution simultaneously in parallel against real PostgreSQL
    await Promise.allSettled([
      completeStep(execution.id, step.id, 'SUCCEEDED', 'concurrent output'),
      cancelExecution(execution.id, target.actor.id, 'concurrent cancellation'),
    ]);
    await advanceExecution(execution.id);

    const finalExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(['CANCELLED', 'SUCCEEDED']).toContain(finalExecution.status);
    await assertTerminalExecutionInvariants(execution.id);
  });

  it('concurrent race: overlapping approveExecutionStep and cancelExecution preserve terminal parent and step invariants', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'action',
          name: 'Action',
          type: 'MANUAL',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: {},
        },
      ],
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);

    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'action' },
    });
    expect(step.status).toBe('WAITING_APPROVAL');

    const digest = computePlanDigest({
      stepKey: step.stepKey,
      stepType: step.type,
      riskClass: step.riskClass,
      config: step.config as Record<string, unknown>,
      agentPoolId: target.pool.id,
      agentId: undefined,
      inputValues: {},
      versionChecksum: target.version.checksum,
    });

    // Fire approval and cancellation simultaneously against real PostgreSQL
    await Promise.allSettled([
      approveExecutionStep({
        executionId: execution.id,
        stepId: step.id,
        planDigest: digest,
        actorId: target.actor.id,
      }),
      cancelExecution(execution.id, target.actor.id, 'racing cancel'),
    ]);
    await advanceExecution(execution.id);

    const finalExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(['CANCELLED', 'SUCCEEDED']).toContain(finalExecution.status);
    await assertTerminalExecutionInvariants(execution.id);
  });

  it('terminalizes attempt, step, and execution when source pool authority is revoked', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'diag',
          name: 'Diagnostics',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'app.service' },
        },
      ],
    });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { host: 'node-a' } },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { agentSelector: { host: 'node-a' } },
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);

    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'diag' },
    });
    expect(step.status).toBe('WAITING_AGENT');

    // Simulate deleting the source pool while step attempt is pending
    await testPrisma.runbookAgentPoolMember.deleteMany({
      where: { poolId: target.pool.id },
    });
    await testPrisma.runbookAgentPool.delete({
      where: { id: target.pool.id },
    });

    // Agent attempts to claim: should detect pool is gone, terminalize attempt + step as FAILED
    const claim = await claimAgentAttempt(target.agent.id);
    expect(claim).toBeNull();

    // Verify attempt and step were atomically terminalized
    const updatedAttempt = await testPrisma.runbookStepAttempt.findFirstOrThrow({
      where: { executionStepId: step.id },
    });
    expect(updatedAttempt.status).toBe('FAILED');
    expect(updatedAttempt.errorCode).toBe('TARGET_AUTHORITY_REVOKED');
    expect(updatedAttempt.completedAt).not.toBeNull();

    const updatedStep = await testPrisma.runbookExecutionStep.findUniqueOrThrow({
      where: { id: step.id },
    });
    expect(updatedStep.status).toBe('FAILED');
    expect(updatedStep.errorCode).toBe('TARGET_AUTHORITY_REVOKED');
    expect(updatedStep.completedAt).not.toBeNull();

    // Advance execution: should transition parent execution to FAILED, not strand in WAITING_AGENT
    await advanceExecution(execution.id);

    const finalExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(finalExecution.status).toBe('FAILED');
    expect(finalExecution.failureCode).toBe('TARGET_AUTHORITY_REVOKED');
    expect(finalExecution.completedAt).not.toBeNull();

    await assertTerminalExecutionInvariants(execution.id);
  });

  it('terminalizes pinned attempt, step, and execution when agent loses source pool membership', async () => {
    const target = await createAgentTarget({
      steps: [
        {
          key: 'diag_pinned',
          name: 'Pinned Diagnostics',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'app.service' },
        },
      ],
    });
    await testPrisma.runbookAgent.update({
      where: { id: target.agent.id },
      data: { labels: { host: 'node-b' } },
    });
    await testPrisma.serviceRunbookBinding.update({
      where: { id: target.binding.id },
      data: { agentSelector: { host: 'node-b' } },
    });
    const execution = await startRunbookExecution({
      runbookId: target.runbook.id,
      bindingId: target.binding.id,
      serviceId: target.service.id,
    });
    await advanceExecution(execution.id);

    const step = await testPrisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: execution.id, stepKey: 'diag_pinned' },
    });
    expect(step.status).toBe('WAITING_AGENT');

    // Remove agent from the source pool
    await testPrisma.runbookAgentPoolMember.deleteMany({
      where: { poolId: target.pool.id, agentId: target.agent.id },
    });

    // Pinned agent attempts to claim: detects lost membership, terminalizes attempt + step as FAILED
    const claim = await claimAgentAttempt(target.agent.id);
    expect(claim).toBeNull();

    const updatedAttempt = await testPrisma.runbookStepAttempt.findFirstOrThrow({
      where: { executionStepId: step.id },
    });
    expect(updatedAttempt.status).toBe('FAILED');
    expect(updatedAttempt.errorCode).toBe('TARGET_AUTHORITY_REVOKED');
    expect(updatedAttempt.completedAt).not.toBeNull();

    const updatedStep = await testPrisma.runbookExecutionStep.findUniqueOrThrow({
      where: { id: step.id },
    });
    expect(updatedStep.status).toBe('FAILED');
    expect(updatedStep.errorCode).toBe('TARGET_AUTHORITY_REVOKED');

    await advanceExecution(execution.id);

    const finalExecution = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(finalExecution.status).toBe('FAILED');
    expect(finalExecution.failureCode).toBe('TARGET_AUTHORITY_REVOKED');
    await assertTerminalExecutionInvariants(execution.id);
  });
});
