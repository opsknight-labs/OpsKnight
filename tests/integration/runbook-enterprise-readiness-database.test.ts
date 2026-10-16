import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentApiError } from '../../agent/src/client';
import { deliverSpoolRecord } from '../../agent/src/result-delivery';
import { ResultSpool } from '../../agent/src/spool';
import { agentArtifactSchema, agentJobResultSchema } from '@/lib/runbooks/schemas';
import { processJob } from '@/lib/jobs/queue';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  testPrisma,
  resetDatabase,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import { advanceExecution, processRunbookJob } from '@/lib/runbooks/orchestrator';
import {
  submitAgentResult,
  storeAgentArtifact,
  claimAgentAttempt,
  fenceAgentAttempt,
} from '@/lib/runbooks/agent-claims';
import { getServiceRulePage } from '@/lib/runbooks/service-rule-page';

const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const leaseToken = 'enterprise-fixture-lease-token-012345678901234567890';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
suite('enterprise deadline, output and pagination contracts (real PostgreSQL)', () => {
  beforeEach(resetDatabase, 30000);
  async function fixture(future = false, malformed = false, withVerification = false) {
    const service = await createTestService('Enterprise fixture');
    const incident = await createTestIncident('Deadline evidence', service.id);
    const runbook = await testPrisma.runbook.create({
      data: { name: 'Enterprise fixture', slug: crypto.randomUUID() },
    });
    const definition = {
      steps: [
        {
          key: 'write',
          name: 'Write',
          type: 'SYSTEMD',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: { action: 'restart', unit: 'fixture.service' },
          ...(withVerification
            ? {
                verification: {
                  steps: [
                    {
                      key: 'verify',
                      name: 'Verify target',
                      type: 'SYSTEMD',
                      riskClass: 'READ_ONLY',
                      config: { action: 'status', unit: 'fixture.service' },
                    },
                  ],
                },
              }
            : {}),
        },
      ],
    };
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        definition: malformed ? { steps: [] } : definition,
        checksum: sha(JSON.stringify(definition)),
      },
    });
    await testPrisma.runbookVersion.update({
      where: { id: version.id },
      data: { state: 'PUBLISHED' },
    });
    const agent = await testPrisma.runbookAgent.create({
      data: {
        name: 'Enterprise fixture',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        capabilities: ['RUNBOOK_SYSTEMD'],
      },
    });
    const deadlineAt = new Date(Date.now() + (future ? 60000 : -1000));
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        serviceId: service.id,
        incidentId: incident.id,
        status: 'RUNNING',
        resolvedTargetAgentId: agent.id,
        deadlineAt,
        definitionChecksum: version.checksum,
      },
    });
    const step = await testPrisma.runbookExecutionStep.create({
      data: {
        executionId: execution.id,
        stepKey: 'write',
        name: 'Write',
        sequence: 0,
        type: 'SYSTEMD',
        riskClass: 'NON_IDEMPOTENT',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 10000),
        config: { action: 'restart', unit: 'fixture.service' },
        attemptCount: 1,
        maxRetries: 3,
      },
    });
    const attempt = await testPrisma.runbookStepAttempt.create({
      data: {
        executionStepId: step.id,
        attemptNumber: 1,
        status: 'RUNNING',
        claimedAgentId: agent.id,
        targetAgentId: agent.id,
        startedAt: new Date(Date.now() - 10000),
        leaseToken: sha(leaseToken),
        leaseExpiresAt: new Date(Date.now() + 30000),
      },
    });
    return { service, runbook, version, agent, execution, step, attempt };
  }
  it.each(['COMPLETED', 'PROCESSING'] as const)(
    'refreshes verification after FAILED → RUNNING → SUCCEEDED while the old job is %s',
    async previousJobStatus => {
      const f = await fixture(true, false, true);
      const capturedAt = new Date(Date.now() - 2000).toISOString();
      const evidence = { capturedAt, serviceState: 'active' };
      await testPrisma.runbookExecutionStep.create({
        data: {
          executionId: f.execution.id,
          stepKey: 'verify',
          name: 'Verify target',
          sequence: 1,
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          status: 'PENDING',
          config: { action: 'status', unit: 'fixture.service' },
        },
      });
      await testPrisma.runbookStepAttempt.update({
        where: { id: f.attempt.id },
        data: {
          leaseExpiresAt: new Date(Date.now() - 1000),
          preState: { capturedAt, serviceState: 'inactive' },
          postState: evidence,
        },
      });
      await reconcileRunbooks();
      await advanceExecution(f.execution.id);
      expect(
        await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
      ).toMatchObject({
        status: 'FAILED',
        failureCode: 'UNKNOWN_OUTCOME',
        verificationRevision: 1,
      });
      const oldId = `runbook-verification:${f.execution.id}:1`;
      expect(await processJob(oldId)).toBe(true);
      expect(
        await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })
      ).toMatchObject({ verificationResult: { verified: false } });
      if (previousJobStatus === 'PROCESSING') {
        // Model a worker that computed evidence but has not yet acknowledged its job.
        await testPrisma.backgroundJob.update({
          where: { id: oldId },
          data: { status: 'PROCESSING' },
        });
      }
      const oldJob = await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: oldId } });
      await submitAgentResult(f.agent.id, {
        attemptId: f.attempt.id,
        leaseToken,
        producedAt: capturedAt,
        status: 'SUCCEEDED',
        exitCode: 0,
        preState: { capturedAt, serviceState: 'inactive' },
        postState: evidence,
      });
      expect(
        await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
      ).toMatchObject({ status: 'RUNNING', completedAt: null });
      expect(
        await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })
      ).toMatchObject({ verificationResult: null });
      await advanceExecution(f.execution.id);
      const claim = await claimAgentAttempt(f.agent.id, true);
      expect(claim?.step.key).toBe('verify');
      await fenceAgentAttempt({
        attemptId: claim!.attemptId,
        agentId: f.agent.id,
        leaseToken: claim!.leaseToken,
      });
      await submitAgentResult(f.agent.id, {
        attemptId: claim!.attemptId,
        leaseToken: claim!.leaseToken,
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
        preState: evidence,
        postState: evidence,
      });
      await advanceExecution(f.execution.id);
      const final = await testPrisma.runbookExecution.findUniqueOrThrow({
        where: { id: f.execution.id },
      });
      expect(final).toMatchObject({ status: 'SUCCEEDED', verificationRevision: 2 });
      expect(await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: oldId } })).toEqual(
        oldJob
      );
      const newId = `runbook-verification:${f.execution.id}:2`;
      expect(await processJob(newId)).toBe(true);
      const proof = (
        await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })
      ).verificationResult;
      expect(proof).toMatchObject({ verified: true, capturedAt: final.completedAt!.toISOString() });
      // A delayed old worker/retry cannot overwrite the newer proof or consume its job.
      await processRunbookJob(oldJob.payload);
      expect(
        (await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } }))
          .verificationResult
      ).toEqual(proof);
      await Promise.all([advanceExecution(f.execution.id), advanceExecution(f.execution.id)]);
      expect(
        await testPrisma.backgroundJob.count({
          where: { id: { startsWith: `runbook-verification:${f.execution.id}:` } },
        })
      ).toBe(2);
      expect(
        await testPrisma.runbookStepAttempt.count({ where: { executionStepId: f.step.id } })
      ).toBe(1);
    }
  );
  it('refreshes terminal failure evidence after a late failure and deduplicates redelivery', async () => {
    const f = await fixture(true, false, true);
    const producedAt = new Date(Date.now() - 2000).toISOString();
    await testPrisma.runbookStepAttempt.update({
      where: { id: f.attempt.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await reconcileRunbooks();
    await advanceExecution(f.execution.id);
    expect(await processJob(`runbook-verification:${f.execution.id}:1`)).toBe(true);
    const result = {
      attemptId: f.attempt.id,
      leaseToken,
      producedAt,
      status: 'FAILED' as const,
      errorCode: 'POLICY_DENIED',
    };
    await submitAgentResult(f.agent.id, result);
    expect(
      await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
    ).toMatchObject({ status: 'FAILED', verificationRevision: 2 });
    expect(await processJob(`runbook-verification:${f.execution.id}:2`)).toBe(true);
    await submitAgentResult(f.agent.id, result);
    expect(
      await testPrisma.backgroundJob.count({
        where: { id: { startsWith: `runbook-verification:${f.execution.id}:` } },
      })
    ).toBe(2);
    expect(
      await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })
    ).toMatchObject({ verificationResult: { verified: false } });
  });
  it.each([false, true])(
    'persists a maximum-output write result when artifact rejected=%s',
    async rejected => {
      const f = await fixture(true);
      const directory = await mkdtemp(join(tmpdir(), 'rbe-db-delivery-'));
      const spool = new ResultSpool(directory);
      const record = {
        attemptId: f.attempt.id,
        leaseToken,
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED' as const,
        exitCode: 0,
        outputPreview: 'Physical action completed',
        localOutput: 'x'.repeat(10 * 1024 * 1024) + '\n[output truncated]',
        postState: {
          capturedAt: new Date().toISOString(),
          logSummary: 'API_TOKEN=unrelated-secret',
        },
      };
      try {
        await spool.put(record);
        await deliverSpoolRecord(
          {
            uploadArtifact: async input => {
              if (rejected) throw new AgentApiError('Artifact rejected', 400);
              return storeAgentArtifact(f.agent.id, agentArtifactSchema.parse(input));
            },
            submit: result => submitAgentResult(f.agent.id, agentJobResultSchema.parse(result)),
          },
          spool,
          record
        );
        await spool.remove(record.attemptId);
        expect(await spool.depth()).toBe(0);
        const saved = await testPrisma.runbookStepAttempt.findUniqueOrThrow({
          where: { id: f.attempt.id },
        });
        expect(saved).toMatchObject({ status: 'SUCCEEDED', exitCode: 0 });
        expect(JSON.stringify(saved.postState)).not.toContain('unrelated-secret');
        if (rejected) expect(saved.outputPreview).toContain('Artifact unavailable: HTTP 400');
        else expect(saved.outputArtifactId).toBeTruthy();
        expect(
          await testPrisma.runbookStepAttempt.count({ where: { executionStepId: f.step.id } })
        ).toBe(1);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  it.each(['reconcile', 'advance'] as const)(
    '%s commits deadline recovery before malformed historical evidence fails, and repeats safely',
    async entry => {
      const f = await fixture(false, true);
      await testPrisma.runbookStepAttempt.update({
        where: { id: f.attempt.id },
        data: { status: 'PENDING' },
      });
      await testPrisma.runbookExecutionStep.update({
        where: { id: f.step.id },
        data: { status: 'WAITING_AGENT' },
      });
      const recover = () =>
        entry === 'reconcile' ? reconcileRunbooks() : advanceExecution(f.execution.id);
      await Promise.all([recover(), recover()]);
      const job = await testPrisma.backgroundJob.findUniqueOrThrow({
        where: { id: `runbook-verification:${f.execution.id}:1` },
      });
      expect(job).toMatchObject({ status: 'PENDING', maxAttempts: 8 });
      await expect(processRunbookJob(job.payload)).rejects.toThrow(
        'RUNBOOK_VERIFICATION_DEFINITION_INVALID'
      );
      // Exhaust the evidence job's bounded retry policy and prove the failure is durable.
      await testPrisma.backgroundJob.update({ where: { id: job.id }, data: { attempts: 7 } });
      expect(await processJob(job.id)).toBe(false);
      expect(
        await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })
      ).toMatchObject({ status: 'FAILED', error: 'RUNBOOK_VERIFICATION_DEFINITION_INVALID' });
      await Promise.all([recover(), recover()]);
      expect(
        await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
      ).toMatchObject({ status: 'TIMED_OUT', failureCode: 'EXECUTION_TIMEOUT' });
      expect(
        await testPrisma.runbookStepAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } })
      ).toMatchObject({ status: 'TIMED_OUT', leaseToken: null });
      expect(await testPrisma.backgroundJob.count({ where: { id: job.id } })).toBe(1);
      expect(
        await testPrisma.incidentEvent.count({
          where: { incidentId: f.execution.incidentId!, type: 'RUNBOOK_FAILED' },
        })
      ).toBe(1);
    }
  );
  it('commits cancellation independently of malformed historical verification', async () => {
    const f = await fixture(false, true);
    await testPrisma.runbookExecution.update({
      where: { id: f.execution.id },
      data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date() },
    });
    await testPrisma.runbookStepAttempt.update({
      where: { id: f.attempt.id },
      data: { status: 'CANCELLED' },
    });
    await testPrisma.runbookExecutionStep.update({
      where: { id: f.step.id },
      data: { status: 'CANCELLED' },
    });
    await advanceExecution(f.execution.id);
    const job = await testPrisma.backgroundJob.findUniqueOrThrow({
      where: { id: `runbook-verification:${f.execution.id}:1` },
    });
    await expect(processRunbookJob(job.payload)).rejects.toThrow(
      'RUNBOOK_VERIFICATION_DEFINITION_INVALID'
    );
    await reconcileRunbooks();
    expect(
      await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
    ).toMatchObject({ status: 'CANCELLED' });
  });
  it.each(['reconcile', 'advance'] as const)(
    'preserves a running write under %s and accepts a fenced result produced before its deadline',
    async entry => {
      const f = await fixture();
      if (entry === 'reconcile') await reconcileRunbooks();
      else await advanceExecution(f.execution.id);
      expect(
        await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
      ).toMatchObject({ status: 'RUNNING', completedAt: null });
      expect(
        await testPrisma.runbookStepAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } })
      ).toMatchObject({ status: 'RUNNING', leaseToken: sha(leaseToken) });
      await submitAgentResult(f.agent.id, {
        attemptId: f.attempt.id,
        leaseToken,
        status: 'SUCCEEDED',
        producedAt: new Date(f.execution.deadlineAt.getTime() - 1).toISOString(),
        outputPreview: 'Physical action completed before deadline',
      });
      await Promise.all([reconcileRunbooks(), advanceExecution(f.execution.id)]);
      expect(
        await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
      ).toMatchObject({ status: 'TIMED_OUT' });
      expect(
        await testPrisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })
      ).toMatchObject({ status: 'SUCCEEDED' });
      expect(
        await testPrisma.incidentEvent.count({
          where: { incidentId: f.execution.incidentId!, type: 'RUNBOOK_FAILED' },
        })
      ).toBe(1);
    }
  );
  it('records a result produced after deadline as uncertain instead of stranding the write or claiming success', async () => {
    const f = await fixture();
    await reconcileRunbooks();
    await submitAgentResult(f.agent.id, {
      attemptId: f.attempt.id,
      leaseToken,
      status: 'SUCCEEDED',
      producedAt: new Date().toISOString(),
    });
    await reconcileRunbooks();
    expect(
      await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
    ).toMatchObject({ status: 'FAILED', failureCode: 'UNKNOWN_OUTCOME' });
    expect(
      await testPrisma.runbookStepAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } })
    ).toMatchObject({ status: 'UNKNOWN', errorCode: 'TIMED_OUT_WITH_UNKNOWN_OUTCOME' });
    expect(
      await testPrisma.runbookStepAttempt.count({ where: { executionStepId: f.step.id } })
    ).toBe(1);
  });
  it('does not retry a read-only result reported after the execution deadline', async () => {
    const f = await fixture();
    await testPrisma.runbookExecutionStep.update({
      where: { id: f.step.id },
      data: { type: 'LINUX_DIAGNOSTICS', riskClass: 'READ_ONLY' },
    });
    await reconcileRunbooks();
    await submitAgentResult(f.agent.id, {
      attemptId: f.attempt.id,
      leaseToken,
      status: 'SUCCEEDED',
      producedAt: new Date().toISOString(),
    });
    expect(
      await testPrisma.runbookStepAttempt.count({ where: { executionStepId: f.step.id } })
    ).toBe(1);
    await reconcileRunbooks();
    expect(
      await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
    ).toMatchObject({ status: 'TIMED_OUT' });
  });
  it('keeps expired started writes unknown and never creates deadline retries', async () => {
    const f = await fixture();
    await testPrisma.runbookStepAttempt.update({
      where: { id: f.attempt.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    await reconcileRunbooks();
    await reconcileRunbooks();
    expect(
      await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })
    ).toMatchObject({ status: 'FAILED', failureCode: 'UNKNOWN_OUTCOME' });
    expect(
      await testPrisma.runbookStepAttempt.count({ where: { executionStepId: f.step.id } })
    ).toBe(1);
  });
  it('sanitizes artifacts before persistence and keeps normalized upload retries idempotent', async () => {
    const f = await fixture(true);
    const content = gzipSync(
      Buffer.from(
        JSON.stringify({ Config: { Env: ['OPAQUE_SECRET=unrelated-value'] }, Id: 'container-a' })
      )
    );
    const input = {
      attemptId: f.attempt.id,
      leaseToken,
      kind: 'OUTPUT' as const,
      mediaType: 'text/plain',
      encoding: 'gzip' as const,
      contentBase64: content.toString('base64'),
      sha256: sha(content),
      truncated: false,
    };
    const first = await storeAgentArtifact(f.agent.id, input);
    const second = await storeAgentArtifact(f.agent.id, input);
    expect(first.id).toBe(second.id);
    const stored = await testPrisma.runbookArtifact.findUniqueOrThrow({ where: { id: first.id } });
    expect(gunzipSync(stored.content).toString()).not.toContain('unrelated-value');
    expect(stored.sha256).toBe(sha(stored.content));
    await expect(
      storeAgentArtifact(f.agent.id, {
        ...input,
        contentBase64: Buffer.from('invalid').toString('base64'),
        sha256: sha('invalid'),
      })
    ).rejects.toThrow('valid gzip');
    expect(await testPrisma.runbookArtifact.count()).toBe(1);
  });
  it('rewrites historical output in one explicit bounded operator batch without changing artifact identity', async () => {
    const f = await fixture(true);
    const content = gzipSync(Buffer.from('DB_PASSWORD=legacy-sensitive-value'));
    const artifact = await testPrisma.runbookArtifact.create({
      data: { attemptId: f.attempt.id, sizeBytes: content.length, sha256: sha(content), content },
    });
    const result = await promisify(execFile)(
      process.execPath,
      [
        'node_modules/ts-node/dist/bin.js',
        '--project',
        'tsconfig.script.json',
        'scripts/sanitize-runbook-artifacts.ts',
        '--apply',
        '--limit=1',
      ],
      { env: process.env, timeout: 30000 }
    );
    expect(result.stdout).not.toContain('legacy-sensitive-value');
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      selected: 1,
      rewritten: 1,
      nextCursor: artifact.id,
    });
    const stored = await testPrisma.runbookArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
    });
    expect(gunzipSync(stored.content).toString()).not.toContain('legacy-sensitive-value');
    expect(stored.sha256).toBe(sha(stored.content));
    expect(
      await testPrisma.auditLog.count({ where: { action: 'runbook.artifact.sanitized' } })
    ).toBe(1);
  });
  it('reports the total active rule count independently of page cursor, search and archived history', async () => {
    const f = await fixture(true);
    await testPrisma.serviceAutomationRule.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        name: `Rule ${i}`,
        runbookId: f.runbook.id,
        serviceId: f.service.id,
      })),
    });
    await testPrisma.serviceAutomationRule.create({
      data: {
        name: 'Archived',
        runbookId: f.runbook.id,
        serviceId: f.service.id,
        detachedAt: new Date(),
        enabled: false,
      },
    });
    const first = await getServiceRulePage(f.service.id);
    expect(first.rules).toHaveLength(20);
    expect(first.total).toBe(25);
    const second = await getServiceRulePage(f.service.id, first.nextCursor);
    expect(second.rules).toHaveLength(5);
    expect(second.total).toBe(25);
    expect(
      (await getServiceRulePage(f.service.id, undefined, testPrisma, { search: 'no-match' })).total
    ).toBe(25);
  });
});
