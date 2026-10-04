import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { computeDefinitionChecksum } from '@/lib/runbooks/definition';
import { advanceExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import {
  claimAgentAttempt,
  fenceAgentAttempt,
  renewAgentAttemptLease,
  submitAgentResult,
} from '@/lib/runbooks/agent-claims';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
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
    const target = await createAgentTarget(definition);
    await testPrisma.runbookInput.create({
      data: {
        runbookVersionId: target.version.id,
        key: 'unit',
        label: 'Unit',
        type: 'STRING',
        required: true,
      },
    });
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
        data: { versionStrategy: 'LATEST_PUBLISHED', runbookVersionId: null },
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
});
