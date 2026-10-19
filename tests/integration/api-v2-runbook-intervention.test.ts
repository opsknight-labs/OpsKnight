import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { beforeEach, expect, it } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  resetDatabase,
  testPrisma as db,
  createTestUser,
  createTestTeam,
  createTestService,
} from '../helpers/test-db';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { processJob } from '@/lib/jobs/queue';
import { resolvedPlanDigest } from '@/lib/runbooks/orchestrator';
import { GET as steps } from '@/app/api/v2/runbooks/executions/[id]/steps/route';
import { GET as evidence } from '@/app/api/v2/runbooks/executions/[id]/evidence/route';
import { GET as events } from '@/app/api/v2/runbooks/executions/[id]/events/route';
import { POST as approve } from '@/app/api/v2/runbooks/executions/[id]/steps/[stepId]/approve/route';
import { POST as reject } from '@/app/api/v2/runbooks/executions/[id]/steps/[stepId]/reject/route';
import { POST as previewRerun } from '@/app/api/v2/runbooks/executions/[id]/rerun-preview/route';
import { POST as rerun } from '@/app/api/v2/runbooks/executions/[id]/rerun/route';
const responseValidator = new Ajv2020({ strict: false, allErrors: true });
addFormats(responseValidator);
responseValidator.addSchema({
  $id: 'intervention-spec',
  components: getOpenApiV2Spec().components,
});
function conformsToSchema(name: string, data: unknown) {
  const validate = responseValidator.getSchema(`intervention-spec#/components/schemas/${name}`)!;
  expect(validate, name).toBeDefined();
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
}
const scopes = ['runbooks:read', 'runbooks:execute', 'runbooks:approve'];
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fixture() {
  const credential = await createV2Credential(scopes, 'RESPONDER');
  const book = await createRunbook(
    {
      name: 'Intervention fixture',
      description: '',
      slug: `intervention-${crypto.randomUUID()}`,
      definition: { steps: [{ key: 'review', name: 'Review', type: 'APPROVAL', config: {} }] },
    },
    credential.user.id
  );
  const version = await publishDraftVersion(book.draftVersionId!, credential.user.id);
  const execution = await db.runbookExecution.create({
    data: {
      runbookId: book.id,
      runbookVersionId: version.id,
      definitionChecksum: version.checksum,
      status: 'WAITING_APPROVAL',
      triggeredByUserId: credential.user.id,
      deadlineAt: new Date(Date.now() + 600000),
      steps: {
        create: {
          stepKey: 'review',
          sequence: 0,
          name: 'Review',
          type: 'APPROVAL',
          riskClass: 'READ_ONLY',
          config: {},
          status: 'WAITING_APPROVAL',
          requiresApproval: true,
        },
      },
    },
    include: { steps: true },
  });
  const step = execution.steps[0];
  return {
    credential,
    execution,
    step,
    version,
    book,
    planDigest: resolvedPlanDigest(step, execution),
    params: { id: execution.id, stepId: step.id },
    path: `/runbooks/executions/${execution.id}`,
  };
}
it('exposes a redacted review only to explicitly scoped approvers', async () => {
  const f = await fixture();
  const response = await invokeV2(steps, f.credential.token, 'GET', `${f.path}/steps`, {
    id: f.execution.id,
  });
  expect(response.status).toBe(200);
  const row = (await response.json()).data[0];
  conformsToSchema('RunbookExecutionStepSummary', row);
  expect(row.pendingApproval.planDigest).toBe(f.planDigest);
  expect(row).not.toHaveProperty('config');
  const reader = await createV2Credential(['runbooks:read'], 'RESPONDER');
  const safe = await invokeV2(steps, reader.token, 'GET', `${f.path}/steps`, {
    id: f.execution.id,
  });
  expect((await safe.json()).data[0].pendingApproval).toBeNull();
  for (const handler of [evidence, events])
    expect(
      (
        await invokeV2(handler, f.credential.token, 'GET', `${f.path}/metadata`, {
          id: f.execution.id,
        })
      ).status
    ).toBe(200);
});
it('approves once, binds retry to the plan and attributes the canonical audit', async () => {
  const f = await fixture();
  const headers = { 'Idempotency-Key': 'review-once' };
  const call = (planDigest = f.planDigest) =>
    invokeV2(
      approve,
      f.credential.token,
      'POST',
      `${f.path}/steps/${f.step.id}/approve`,
      f.params,
      { planDigest },
      headers
    );
  expect((await call()).status).toBe(202);
  expect((await call()).headers.get('idempotency-replayed')).toBe('true');
  expect((await call('a'.repeat(64))).status).toBe(409);
  expect(
    (await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } }))
      .approvedPlanDigest
  ).toBe(f.planDigest);
  const audits = await db.auditLog.findMany({
    where: { action: 'runbook.execution.step.approved' },
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: f.credential.key.id },
  });
});
it('rejects the reviewed step and queues parent cancellation without approving it', async () => {
  const f = await fixture();
  const request = () =>
    invokeV2(
      reject,
      f.credential.token,
      'POST',
      `${f.path}/steps/${f.step.id}/reject`,
      f.params,
      { planDigest: f.planDigest, reason: 'Operator declined the reviewed action' },
      { 'Idempotency-Key': 'reject-once' }
    );
  expect((await request()).status).toBe(202);
  expect((await request()).headers.get('idempotency-replayed')).toBe('true');
  expect(
    (await db.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })).status
  ).toBe('CANCEL_REQUESTED');
  expect(
    await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })
  ).toMatchObject({ status: 'CANCELLED', approvedAt: null });
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.step.rejected' } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.cancel.requested' } })).toBe(
    1
  );
});
it('denies ordinary executor scopes, foreign step IDs and changed plans before side effects', async () => {
  const f = await fixture();
  const executor = await createV2Credential(['runbooks:read', 'runbooks:execute'], 'RESPONDER');
  const path = `${f.path}/steps/${f.step.id}/approve`;
  expect(
    (
      await invokeV2(
        approve,
        executor.token,
        'POST',
        path,
        f.params,
        { planDigest: f.planDigest },
        { 'Idempotency-Key': 'no-scope' }
      )
    ).status
  ).toBe(403);
  expect(
    (
      await invokeV2(
        approve,
        f.credential.token,
        'POST',
        path,
        { ...f.params, stepId: 'cmissingstep000000000000000' },
        { planDigest: f.planDigest },
        { 'Idempotency-Key': 'wrong-step' }
      )
    ).status
  ).toBe(404);
  const mismatch = await invokeV2(
    approve,
    f.credential.token,
    'POST',
    path,
    f.params,
    { planDigest: 'f'.repeat(64) },
    { 'Idempotency-Key': 'wrong-plan' }
  );
  expect(mismatch.status).toBe(409);
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.step.approved' } })).toBe(0);
});
it('reauthorizes cached decisions after ownership changes', async () => {
  const f = await fixture();
  const request = () =>
    invokeV2(
      approve,
      f.credential.token,
      'POST',
      `${f.path}/steps/${f.step.id}/approve`,
      f.params,
      { planDigest: f.planDigest },
      { 'Idempotency-Key': 'ownership-replay' }
    );
  expect((await request()).status).toBe(202);
  const other = await createTestUser({ role: 'RESPONDER' });
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { triggeredByUserId: other.id },
  });
  expect((await request()).status).toBe(404);
});
it('previews and starts a terminal rerun using the exact current reviewed plan', async () => {
  const f = await fixture();
  expect(
    (
      await invokeV2(
        previewRerun,
        f.credential.token,
        'POST',
        `${f.path}/rerun-preview`,
        { id: f.execution.id },
        {}
      )
    ).status
  ).toBe(409);
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { status: 'SUCCEEDED', completedAt: new Date() },
  });
  const previewResponse = await invokeV2(
    previewRerun,
    f.credential.token,
    'POST',
    `${f.path}/rerun-preview`,
    { id: f.execution.id },
    {}
  );
  expect(previewResponse.status).toBe(200);
  const preview = (await previewResponse.json()).data;
  const previewAudit = await db.auditLog.findFirstOrThrow({
    where: { action: 'runbook.execution.previewed' },
  });
  expect(previewAudit.details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: f.credential.key.id },
  });
  const body = {
    expectedPlanDigest: preview.digest,
    previewAuthorizationToken: preview.authorizationToken,
  };
  const request = () =>
    invokeV2(rerun, f.credential.token, 'POST', `${f.path}/rerun`, { id: f.execution.id }, body, {
      'Idempotency-Key': 'rerun-once',
    });
  const accepted = await request();
  expect(accepted.status, await accepted.clone().text()).toBe(202);
  const next = (await accepted.json()).data;
  conformsToSchema('RunbookRerun', next);
  expect(next.executionId).not.toBe(f.execution.id);
  expect((await request()).headers.get('idempotency-replayed')).toBe('true');
  expect(await db.runbookExecution.count()).toBe(2);
});

it.each(['USER', 'AUDITOR'] as const)(
  'denies %s approval even with explicit scopes',
  async role => {
    const f = await fixture();
    const credential = await createV2Credential(scopes, role);
    expect(
      (
        await invokeV2(
          approve,
          credential.token,
          'POST',
          `${f.path}/steps/${f.step.id}/approve`,
          f.params,
          { planDigest: f.planDigest },
          { 'Idempotency-Key': 'role-denied' }
        )
      ).status
    ).toBe(403);
  }
);
it('permits only one of concurrent approve and reject decisions for the same waiting step', async () => {
  const f = await fixture();
  const results = await Promise.all([
    invokeV2(
      approve,
      f.credential.token,
      'POST',
      `${f.path}/steps/${f.step.id}/approve`,
      f.params,
      { planDigest: f.planDigest },
      { 'Idempotency-Key': 'concurrent-approve' }
    ),
    invokeV2(
      reject,
      f.credential.token,
      'POST',
      `${f.path}/steps/${f.step.id}/reject`,
      f.params,
      { planDigest: f.planDigest, reason: 'Declined' },
      { 'Idempotency-Key': 'concurrent-reject' }
    ),
  ]);
  expect(results.map(result => result.status).sort()).toEqual([202, 409]);
  expect(
    await db.auditLog.count({
      where: {
        action: { in: ['runbook.execution.step.approved', 'runbook.execution.step.rejected'] },
      },
    })
  ).toBe(1);
});
it('does not reject an already cancelled execution or leave a partially cancelled step', async () => {
  const f = await fixture();
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { status: 'CANCEL_REQUESTED' },
  });
  const response = await invokeV2(
    reject,
    f.credential.token,
    'POST',
    `${f.path}/steps/${f.step.id}/reject`,
    f.params,
    { planDigest: f.planDigest, reason: 'Late rejection' },
    { 'Idempotency-Key': 'late-rejection' }
  );
  expect(response.status).toBe(409);
  expect(
    (await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })).status
  ).toBe('WAITING_APPROVAL');
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.step.rejected' } })).toBe(0);
});
it('rolls back rejection, cancellation, queued work and retry receipt if the canonical audit fails', async () => {
  const f = await fixture();
  const before = await db.backgroundJob.count();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_intervention_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'runbook.execution.step.rejected' THEN RAISE EXCEPTION 'Rejection audit unavailable'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_intervention_audit_failure_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_intervention_audit_failure()'
  );
  const call = () =>
    invokeV2(
      reject,
      f.credential.token,
      'POST',
      `${f.path}/steps/${f.step.id}/reject`,
      f.params,
      { planDigest: f.planDigest, reason: 'Reviewed rejection' },
      { 'Idempotency-Key': 'atomic-rejection' }
    );
  try {
    expect((await call()).status).toBe(500);
    expect(
      (await db.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })).status
    ).toBe('WAITING_APPROVAL');
    expect(
      (await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })).status
    ).toBe('WAITING_APPROVAL');
    expect(await db.backgroundJob.count()).toBe(before);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER test_intervention_audit_failure_trigger ON "AuditLog"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION test_intervention_audit_failure()');
  }
  expect((await call()).status).toBe(202);
});
it('requires retry keys and rechecks revoked approval scope before cached success', async () => {
  const f = await fixture();
  const path = `${f.path}/steps/${f.step.id}/approve`;
  expect(
    (
      await invokeV2(approve, f.credential.token, 'POST', path, f.params, {
        planDigest: f.planDigest,
      })
    ).status
  ).toBe(400);
  const call = () =>
    invokeV2(
      approve,
      f.credential.token,
      'POST',
      path,
      f.params,
      { planDigest: f.planDigest },
      { 'Idempotency-Key': 'scope-revocation' }
    );
  expect((await call()).status).toBe(202);
  await db.apiKey.update({
    where: { id: f.credential.key.id },
    data: { scopes: ['runbooks:read', 'runbooks:execute'] },
  });
  expect((await call()).status).toBe(403);
});

it('reconciles a rejected execution through the actual queue handler without assigning Agent work', async () => {
  const f = await fixture();
  const response = await invokeV2(
    reject,
    f.credential.token,
    'POST',
    `${f.path}/steps/${f.step.id}/reject`,
    f.params,
    { planDigest: f.planDigest, reason: 'Do not execute' },
    { 'Idempotency-Key': 'reject-worker' }
  );
  expect(response.status).toBe(202);
  const jobs = await db.backgroundJob.findMany({
    where: { status: 'PENDING', payload: { path: ['executionId'], equals: f.execution.id } },
  });
  expect(jobs).toHaveLength(1);
  expect(await processJob(jobs[0].id)).toBe(true);
  expect(
    (await db.runbookExecution.findUniqueOrThrow({ where: { id: f.execution.id } })).status
  ).toBe('CANCELLED');
  expect(await db.runbookStepAttempt.count()).toBe(0);
});

it('withholds reviewed plans and denies decisions for unrelated explicitly scoped responders', async () => {
  const f = await fixture();
  const outsider = await createV2Credential(scopes, 'RESPONDER');
  const response = await invokeV2(steps, outsider.token, 'GET', `${f.path}/steps`, {
    id: f.execution.id,
  });
  expect(response.status).toBe(200);
  expect((await response.json()).data[0].pendingApproval).toBeNull();
  expect(
    (
      await invokeV2(
        approve,
        outsider.token,
        'POST',
        `${f.path}/steps/${f.step.id}/approve`,
        f.params,
        { planDigest: f.planDigest },
        { 'Idempotency-Key': 'foreign-approval' }
      )
    ).status
  ).toBe(404);
  expect(await db.auditLog.count({ where: { action: 'runbook.execution.step.approved' } })).toBe(0);
});

it('redacts credential evidence, bounds response output and never exposes leases or raw artifacts', async () => {
  const f = await fixture();
  await db.runbookStepAttempt.create({
    data: {
      executionStepId: f.step.id,
      attemptNumber: 1,
      leaseToken: 'internal-lease-value',
      outputPreview: 'private raw output',
      preState: {
        password: 'private-password-value',
        nested: { authorization: 'private-auth-value' },
        state: 'ready',
      },
      postState: { token: 'private-token-value', diagnostic: 'x'.repeat(20000) },
    },
  });
  const response = await invokeV2(evidence, f.credential.token, 'GET', `${f.path}/evidence`, {
    id: f.execution.id,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.data).toHaveLength(1);
  conformsToSchema('RunbookExecutionEvidence', body.data[0]);
  expect(body.data[0].evidence.length).toBeLessThanOrEqual(16000);
  expect(body.data[0].evidence).toContain('[REDACTED]');
  const serialized = JSON.stringify(body);
  for (const secret of [
    'private-password-value',
    'private-auth-value',
    'private-token-value',
    'internal-lease-value',
    'private raw output',
  ])
    expect(serialized).not.toContain(secret);
  expect(body.data[0]).not.toHaveProperty('preState');
  expect(body.data[0]).not.toHaveProperty('leaseToken');
});

it('rejects a formerly reviewed digest when execution inputs change', async () => {
  const f = await fixture();
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { inputValues: { environment: 'changed' } },
  });
  const response = await invokeV2(
    approve,
    f.credential.token,
    'POST',
    `${f.path}/steps/${f.step.id}/approve`,
    f.params,
    { planDigest: f.planDigest },
    { 'Idempotency-Key': 'stale-review' }
  );
  expect(response.status).toBe(409);
  expect(
    (await db.runbookExecutionStep.findUniqueOrThrow({ where: { id: f.step.id } })).approvedAt
  ).toBeNull();
});

it('does not start a rerun from an expired authorization or an archived runbook', async () => {
  const f = await fixture();
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { status: 'SUCCEEDED', completedAt: new Date() },
  });
  const previewResponse = await invokeV2(
    previewRerun,
    f.credential.token,
    'POST',
    `${f.path}/rerun-preview`,
    { id: f.execution.id },
    {}
  );
  expect(previewResponse.status).toBe(200);
  const preview = (await previewResponse.json()).data;
  await db.runbookPreviewAuthorization.updateMany({
    where: { actorId: f.credential.user.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const call = () =>
    invokeV2(
      rerun,
      f.credential.token,
      'POST',
      `${f.path}/rerun`,
      { id: f.execution.id },
      { expectedPlanDigest: preview.digest, previewAuthorizationToken: preview.authorizationToken },
      { 'Idempotency-Key': 'expired-rerun' }
    );
  expect((await call()).status).toBe(400);
  expect(await db.runbookExecution.count()).toBe(1);
  await db.runbook.update({ where: { id: f.book.id }, data: { archivedAt: new Date() } });
  expect((await call()).status).toBe(409);
  expect(await db.runbookExecution.count()).toBe(1);
});

it('permits service-team reviewers and rechecks membership before replay', async () => {
  const f = await fixture();
  const reviewer = await createV2Credential(scopes, 'RESPONDER');
  const team = await createTestTeam('Intervention reviewers');
  const service = await createTestService('Reviewed service', team.id);
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { serviceId: service.id },
  });
  const membership = await db.teamMember.create({
    data: { teamId: team.id, userId: reviewer.user.id },
  });
  const response = await invokeV2(steps, reviewer.token, 'GET', `${f.path}/steps`, {
    id: f.execution.id,
  });
  expect(response.status).toBe(200);
  expect((await response.json()).data[0].pendingApproval.planDigest).toBe(f.planDigest);
  const call = () =>
    invokeV2(
      approve,
      reviewer.token,
      'POST',
      `${f.path}/steps/${f.step.id}/approve`,
      f.params,
      { planDigest: f.planDigest },
      { 'Idempotency-Key': 'team-review' }
    );
  expect((await call()).status).toBe(202);
  await db.teamMember.delete({ where: { id: membership.id } });
  expect((await call()).status).toBe(404);
});

it('withholds arbitrary submitted plaintext from real approval and evidence responses', async () => {
  const f = await fixture();
  const value = 'opaque-reviewed-value-8193"\\tail';
  await db.runbookExecution.update({
    where: { id: f.execution.id },
    data: { inputValues: { innocuous: value } },
  });
  await db.runbookExecutionStep.update({
    where: { id: f.step.id },
    data: { type: 'BASH', config: { command: 'echo ${{ inputs.innocuous }}' } },
  });
  await db.runbookStepAttempt.create({
    data: { executionStepId: f.step.id, attemptNumber: 1, postState: { custom: value } },
  });
  for (const [handler, suffix] of [
    [steps, 'steps'],
    [evidence, 'evidence'],
  ] as const) {
    const response = await invokeV2(handler, f.credential.token, 'GET', `${f.path}/${suffix}`, {
      id: f.execution.id,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('opaque-reviewed-value');
  }
});
