import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { computeDefinitionChecksum } from '@/lib/runbooks/definition';
import { createServiceBinding, updateServiceBinding } from '@/lib/runbooks/bindings';
import { advanceExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
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
import { getExecutionSigningKey } from '@/lib/runbooks/execution-signing';
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
    const target = await createAgentTarget({
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
    });
    await testPrisma.runbookInput.createMany({
      data: [
        {
          runbookVersionId: target.version.id,
          key: 'unit',
          label: 'Unit',
          type: 'SECRET_REF',
          required: true,
        },
        {
          runbookVersionId: target.version.id,
          key: 'unused',
          label: 'Unused token',
          type: 'SECRET_REF',
          required: true,
        },
      ],
    });
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
});
