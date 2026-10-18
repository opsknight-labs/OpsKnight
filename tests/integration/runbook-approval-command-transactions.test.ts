import { beforeEach, expect, it } from 'vitest';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { approveExecutionStep } from '@/lib/runbooks/orchestrator';
import { computePlanDigest } from '@/lib/runbooks/definition';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

async function fixture() {
  const actor = await createTestUser({ role: 'RESPONDER' });
  const runbook = await createRunbook(
    {
      name: 'Approval transaction fixture',
      slug: `approval-tx-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [{ key: 'review', name: 'Review', type: 'APPROVAL', config: {} }],
      },
    },
    actor.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, actor.id);
  const execution = await db.runbookExecution.create({
    data: {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      definitionChecksum: version.checksum,
      status: 'WAITING_APPROVAL',
      triggeredByUserId: actor.id,
      deadlineAt: new Date(Date.now() + 60_000),
      steps: {
        create: {
          stepKey: 'review',
          sequence: 0,
          name: 'Review',
          type: 'APPROVAL',
          riskClass: 'READ_ONLY',
          config: {},
          status: 'WAITING_APPROVAL',
        },
      },
    },
    include: { steps: true },
  });
  const step = execution.steps[0];
  const planDigest = computePlanDigest({
    stepKey: step.stepKey,
    stepType: step.type,
    riskClass: step.riskClass,
    config: {},
    inputValues: {},
    versionChecksum: version.checksum,
  });
  return {
    execution,
    step,
    input: { executionId: execution.id, stepId: step.id, planDigest, actorId: actor.id },
  };
}

it('rolls back the approval, canonical audit and advance job with its caller transaction', async () => {
  const { execution, step, input } = await fixture();
  const auditsBefore = await db.auditLog.count();
  const jobsBefore = await db.backgroundJob.count();
  await expect(
    db.$transaction(async tx => {
      await approveExecutionStep(input, tx, { apiClientId: 'approval-credential' });
      expect(
        (await tx.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } })).status
      ).toBe('PENDING');
      expect(
        await tx.auditLog.count({ where: { action: 'runbook.execution.step.approved' } })
      ).toBe(1);
      throw new Error('Caller rollback');
    })
  ).rejects.toThrow('Caller rollback');
  expect(
    (await db.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })).status
  ).toBe('WAITING_APPROVAL');
  expect(
    (await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } })).approvedAt
  ).toBeNull();
  expect(await db.auditLog.count()).toBe(auditsBefore);
  expect(await db.backgroundJob.count()).toBe(jobsBefore);
});

it('commits one canonical API-attributed event and rejects a second decision without extra work', async () => {
  const { execution, step, input } = await fixture();
  await db.$transaction(tx =>
    approveExecutionStep(input, tx, { apiClientId: 'approval-credential' })
  );
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'runbook.execution.step.approved', entityId: execution.id },
  });
  expect(audit.details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: 'approval-credential', stepId: step.id, planDigest: input.planDigest },
  });
  expect(
    (await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } })).approvedById
  ).toBe(input.actorId);
  const jobs = await db.backgroundJob.count();
  await expect(approveExecutionStep(input)).rejects.toThrow();
  expect(await db.backgroundJob.count()).toBe(jobs);
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.step.approved' } })).toBe(1);
});

it('keeps the shared UI decision path and rejects stale plan digests atomically', async () => {
  const { step, input } = await fixture();
  const jobs = await db.backgroundJob.count();
  await expect(approveExecutionStep({ ...input, planDigest: '0'.repeat(64) })).rejects.toThrow();
  expect((await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe(
    'WAITING_APPROVAL'
  );
  expect(await db.backgroundJob.count()).toBe(jobs);
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.step.approved' } })).toBe(0);
  await approveExecutionStep(input);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'runbook.execution.step.approved' },
  });
  expect(audit.details).toMatchObject({ source: 'UI', metadata: { stepId: step.id } });
  expect(audit.details).not.toHaveProperty('metadata.apiClientId');
});
