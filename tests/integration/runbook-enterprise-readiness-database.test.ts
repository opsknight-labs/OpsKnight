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
import { advanceExecution } from '@/lib/runbooks/orchestrator';
import { submitAgentResult, storeAgentArtifact } from '@/lib/runbooks/agent-claims';
import { getServiceRulePage } from '@/lib/runbooks/service-rule-page';

const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const leaseToken = 'enterprise-fixture-lease-token-012345678901234567890';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
suite('enterprise deadline, output and pagination contracts (real PostgreSQL)', () => {
  beforeEach(resetDatabase, 30000);
  async function fixture(future = false) {
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
        },
      ],
    };
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        definition,
        checksum: sha(JSON.stringify(definition)),
      },
    });
    await testPrisma.runbookVersion.update({
      where: { id: version.id },
      data: { state: 'PUBLISHED' },
    });
    const agent = await testPrisma.runbookAgent.create({
      data: { name: 'Enterprise fixture', status: 'ONLINE', lastHeartbeatAt: new Date() },
    });
    const deadlineAt = new Date(Date.now() + (future ? 60000 : -1000));
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        serviceId: service.id,
        incidentId: incident.id,
        status: 'RUNNING',
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
