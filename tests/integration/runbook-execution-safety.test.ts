import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { computeDefinitionChecksum } from '@/lib/runbooks/definition';
import { advanceExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import {
  claimAgentAttempt,
  fenceAgentAttempt,
  submitAgentResult,
} from '@/lib/runbooks/agent-claims';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import { createTestService, createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

async function createPublishedRunbook(definition: RunbookDefinition) {
  const runbook = await testPrisma.runbook.create({
    data: { name: `Safety ${crypto.randomUUID()}`, slug: `safety-${crypto.randomUUID()}` },
  });
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      definition: definition as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(definition),
      publishedAt: new Date(),
    },
  });
  await testPrisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  return { runbook, version };
}

async function createAgentTarget(definition: RunbookDefinition) {
  const [{ runbook, version }, service, agent, actor] = await Promise.all([
    createPublishedRunbook(definition),
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
  beforeEach(async () => resetDatabase());
  afterAll(async () => testPrisma.$disconnect());

  it('counts pending write steps in the Agent-pool concurrency guard', async () => {
    const definition: RunbookDefinition = {
      description: 'Pool write limit',
      steps: [
        {
          key: 'restart',
          name: 'Restart service',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
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
          key: 'restart',
          name: 'Restart service',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { action: 'restart', unit: 'api.service' },
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
});
