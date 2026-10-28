import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestUser, testPrisma as db } from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import {
  archiveRunbook,
  cloneVersionToDraft,
  createRunbook,
  publishDraftVersion,
} from '@/lib/runbooks/versioning';
import { previewRunbookExecution, resolvedPlanDigest } from '@/lib/runbooks/orchestrator';
import { buildRerunRequest, loadRerunSource } from '@/lib/runbooks/rerun';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { CostBudget } from '@/lib/mcp/core/budget';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

type State = Record<string, string>;

// APPROVAL steps need no Agent, so previews are ready and executions stay inert.
const definition = (name = 'Review') => ({
  steps: [{ key: 'review', name, type: 'APPROVAL', config: {} }],
});
const slug = () => `mcp-approval-${randomUUID().slice(0, 8)}`;

async function draftRunbook(f: Fixture) {
  const book = await createRunbook(
    { name: 'Approval runbook', slug: slug(), description: '', definition: definition() },
    f.user.id
  );
  return { runbookId: book.id, versionId: book.draftVersionId! };
}
async function publishedRunbook(f: Fixture) {
  const draft = await draftRunbook(f);
  const version = await publishDraftVersion(draft.versionId, f.user.id);
  return { runbookId: draft.runbookId, versionId: version.id };
}
const runbook = (s: State) => db.runbook.findUniqueOrThrow({ where: { id: s.runbookId } });
const runbookEtag = async (s: State) => `"${(await runbook(s)).revision}"`;
const draft = (s: State) => db.runbookVersion.findUniqueOrThrow({ where: { id: s.versionId } });
const draftEtag = async (s: State) => `"${(await draft(s)).draftRevision}"`;
// The Runbook revision trigger bumps the revision on any update.
const touchRunbook = async (s: State) => {
  await db.runbook.update({ where: { id: s.runbookId }, data: { description: 'Out of band' } });
};
const touchDraft = async (s: State) => {
  await db.runbookVersion.update({
    where: { id: s.versionId },
    data: { draftRevision: { increment: 1 } },
  });
};

/** An execution waiting on one approval step, started by the MCP requester. */
async function waitingExecution(f: Fixture, triggeredByUserId = f.user.id) {
  const r = await publishedRunbook(f);
  const version = await db.runbookVersion.findUniqueOrThrow({ where: { id: r.versionId } });
  const execution = await db.runbookExecution.create({
    data: {
      runbookId: r.runbookId,
      runbookVersionId: version.id,
      definitionChecksum: version.checksum,
      status: 'WAITING_APPROVAL',
      triggeredByUserId,
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
    ...r,
    executionId: execution.id,
    stepId: step.id,
    planDigest: resolvedPlanDigest(step, execution),
  };
}
const execution = (s: State) =>
  db.runbookExecution.findUniqueOrThrow({ where: { id: s.executionId } });
const step = (s: State) => db.runbookExecutionStep.findUniqueOrThrow({ where: { id: s.stepId } });

/** A finished run plus the requester's native rerun preview (same rules as the REST preview). */
async function finishedRunWithPreview(f: Fixture) {
  const run = await waitingExecution(f);
  await db.runbookExecution.update({
    where: { id: run.executionId },
    data: { status: 'SUCCEEDED', completedAt: new Date() },
  });
  const source = await loadRerunSource(run.executionId);
  const preview = await previewRunbookExecution(buildRerunRequest(source!, f.user.id));
  return { ...run, digest: preview.digest, token: preview.authorizationToken! };
}
const runCount = (s: State) => db.runbookExecution.count({ where: { runbookId: s.runbookId } });
const rerunArgs = (s: State, token = s.token) => ({
  path: { id: s.executionId },
  body: { expectedPlanDigest: s.digest, previewAuthorizationToken: token },
});

const scenarios: Scenario[] = [
  {
    name: 'update runbook metadata',
    operationId: 'updateRunbookMetadata',
    setup: async f => draftRunbook(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.runbookId },
        body: { name: 'Approved name', description: 'Approved description' },
        ifMatch: await runbookEtag(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await runbook(s);
      return [row.name, row.description];
    },
    invalidate: async (_f, s) => touchRunbook(s),
  },
  {
    name: 'update runbook draft',
    operationId: 'updateRunbookDraft',
    setup: async f => draftRunbook(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.runbookId, versionId: s.versionId },
        body: { definition: definition('Approved review'), inputs: [] },
        ifMatch: await draftEtag(s),
      },
    }),
    effect: async (_f, s) => (await draft(s)).checksum,
    invalidate: async (_f, s) => touchDraft(s),
  },
  {
    name: 'create runbook',
    operationId: 'createRunbook',
    setup: async () => ({ slug: slug() }),
    input: async (_f, s) => ({
      args: {
        body: { name: 'Approved runbook', slug: s.slug, description: '', definition: definition() },
      },
    }),
    effect: async (_f, s) =>
      (await db.runbook.findMany({ where: { slug: s.slug }, include: { versions: true } })).map(
        row => [row.name, row.versions.map(version => version.state)]
      ),
  },
  {
    name: 'cancel runbook execution',
    operationId: 'cancelRunbookExecution',
    setup: async f => waitingExecution(f),
    input: async (_f, s) => ({
      args: { path: { id: s.executionId }, body: { reason: 'Reviewed cancellation' } },
    }),
    effect: async (_f, s) => [
      (await execution(s)).status,
      await db.auditLog.count({
        where: { entityId: s.executionId, action: 'runbook.execution.cancel.requested' },
      }),
    ],
  },
  {
    name: 'rerun runbook execution',
    operationId: 'rerunRunbookExecution',
    setup: async f => finishedRunWithPreview(f),
    input: async (_f, s) => ({ args: rerunArgs(s) }),
    effect: async (_f, s) => runCount(s),
  },
  {
    name: 'approve runbook execution step',
    operationId: 'approveRunbookExecutionStep',
    setup: async f => waitingExecution(f),
    input: async (_f, s) => ({
      args: { path: { id: s.executionId, stepId: s.stepId }, body: { planDigest: s.planDigest } },
    }),
    effect: async (_f, s) => {
      const row = await step(s);
      return [row.status, row.approvedById, row.approvedPlanDigest, (await execution(s)).status];
    },
  },
  {
    name: 'reject runbook execution step',
    operationId: 'rejectRunbookExecutionStep',
    setup: async f => waitingExecution(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.executionId, stepId: s.stepId },
        body: { planDigest: s.planDigest, reason: 'Reviewed rejection' },
      },
    }),
    effect: async (_f, s) => [(await step(s)).status, (await execution(s)).status],
  },
  {
    name: 'archive runbook',
    operationId: 'archiveRunbook',
    setup: async f => publishedRunbook(f),
    input: async (_f, s) => ({
      args: { path: { id: s.runbookId }, body: {}, ifMatch: await runbookEtag(s) },
    }),
    effect: async (_f, s) => (await runbook(s)).archivedAt !== null,
    invalidate: async (_f, s) => touchRunbook(s),
  },
  {
    name: 'create runbook draft',
    operationId: 'createRunbookDraft',
    setup: async f => publishedRunbook(f),
    input: async (_f, s) => ({
      args: { path: { id: s.runbookId }, body: { sourceVersionId: s.versionId } },
    }),
    effect: async (_f, s) =>
      (
        await db.runbookVersion.findMany({
          where: { runbookId: s.runbookId },
          orderBy: { version: 'asc' },
        })
      ).map(row => [row.version, row.state]),
  },
  {
    name: 'publish runbook draft',
    operationId: 'publishRunbookDraft',
    setup: async f => draftRunbook(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.runbookId, versionId: s.versionId },
        body: {},
        ifMatch: await draftEtag(s),
      },
    }),
    effect: async (_f, s) => [(await draft(s)).state, (await runbook(s)).publishedVersionId],
    invalidate: async (_f, s) => touchDraft(s),
  },
  {
    name: 'duplicate runbook',
    operationId: 'duplicateRunbook',
    setup: async f => {
      const r = await publishedRunbook(f);
      return { ...r, slug: (await runbook(r)).slug };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.runbookId }, body: {}, ifMatch: await runbookEtag(s) },
    }),
    effect: async (_f, s) =>
      (await db.runbook.findMany({ where: { slug: { startsWith: `${s.slug}-copy` } } })).map(
        row => [row.slug, row.name]
      ),
    invalidate: async (_f, s) => touchRunbook(s),
  },
  {
    name: 'restore runbook',
    operationId: 'restoreRunbook',
    setup: async f => {
      const r = await publishedRunbook(f);
      await archiveRunbook(r.runbookId, f.user.id);
      return r;
    },
    input: async (_f, s) => ({
      args: { path: { id: s.runbookId }, body: {}, ifMatch: await runbookEtag(s) },
    }),
    effect: async (_f, s) => (await runbook(s)).archivedAt === null,
    invalidate: async (_f, s) => touchRunbook(s),
  },
];

describeApprovalScenarios(scenarios);

async function approved(f: Fixture, operationId: string, args: Record<string, unknown>) {
  const prepared = await prepareMcpOperation(f.ctx(), {
    operationId,
    args,
    idempotencyKey: prepareKey(),
  });
  await f.review(prepared);
  return prepared;
}
const commit = (f: Fixture, prepared: { approvalId: string }) =>
  commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
const approvalStatus = async (prepared: { approvalId: string }) =>
  (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: prepared.approvalId } })).status;

/** A separate grant and token for the same requester that omit runbooks:read. */
async function withoutRead(f: Fixture) {
  const scopes = f.ctx().tokenScopes.filter(scope => scope !== 'runbooks:read');
  const client = await db.mcpClient.create({
    data: { name: 'Narrow client', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: f.user.id,
      userTokenVersion: f.user.tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    ctx: (): ExecutionContext => ({
      grantId: grant.id,
      credentialId: token.id,
      tokenScopes: scopes,
      requestId: 'narrow-scope-test',
      budget: new CostBudget(),
    }),
  };
}

describe('runbook approval batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: {
            id: 'cmcpgenericdispatch0000001',
            versionId: 'cmcpgenericdispatch0000002',
            stepId: 'cmcpgenericdispatch0000003',
          },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  // Routes without If-Match: the frozen body binds the reviewed state instead.
  it('cancel: binds the frozen request to a still-cancellable execution', async () => {
    const f = await fixture();
    const s = await waitingExecution(f);
    const prepared = await approved(f, 'cancelRunbookExecution', {
      path: { id: s.executionId },
      body: { reason: 'Reviewed cancellation' },
    });
    await db.runbookExecution.update({
      where: { id: s.executionId },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
    await expect(commit(f, prepared)).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect((await execution(s)).status).toBe('SUCCEEDED');
    expect(await approvalStatus(prepared)).not.toBe('COMMITTED');
    expect(
      await db.auditLog.count({
        where: { entityId: s.executionId, action: 'runbook.execution.cancel.requested' },
      })
    ).toBe(0);
  });

  it('createRunbookDraft: binds the frozen source version and never adds a second draft', async () => {
    const f = await fixture();
    const s = await publishedRunbook(f);
    const foreign = await publishedRunbook(f);
    const wrong = await approved(f, 'createRunbookDraft', {
      path: { id: s.runbookId },
      body: { sourceVersionId: foreign.versionId },
    });
    await expect(commit(f, wrong)).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    const prepared = await approved(f, 'createRunbookDraft', {
      path: { id: s.runbookId },
      body: { sourceVersionId: s.versionId },
    });
    // A draft opened out of band after review is returned as-is, not duplicated.
    const existing = await cloneVersionToDraft(s.versionId, f.user.id);
    await expect(commit(f, prepared)).resolves.toMatchObject({ status: 'COMMITTED' });
    expect(
      await db.runbookVersion.findMany({ where: { runbookId: s.runbookId, state: 'DRAFT' } })
    ).toEqual([expect.objectContaining({ id: existing.id })]);
  });

  it('createRunbook: the reviewed slug binds the request and a taken slug is refused', async () => {
    const f = await fixture();
    const taken = await draftRunbook(f);
    const prepared = await approved(f, 'createRunbook', {
      body: {
        name: 'Duplicate slug',
        slug: (await runbook(taken)).slug,
        description: '',
        definition: definition(),
      },
    });
    await expect(commit(f, prepared)).rejects.toThrow(/MCP_DOMAIN_REJECTED/);
    expect(await db.runbook.count({ where: { name: 'Duplicate slug' } })).toBe(0);
  });

  it.each(['approveRunbookExecutionStep', 'rejectRunbookExecutionStep'])(
    '%s: binds the reviewed plan digest and refuses a changed plan',
    async operationId => {
      const f = await fixture();
      const s = await waitingExecution(f);
      const prepared = await approved(f, operationId, {
        path: { id: s.executionId, stepId: s.stepId },
        body: {
          planDigest: s.planDigest,
          ...(operationId === 'rejectRunbookExecutionStep' ? { reason: 'Reviewed' } : {}),
        },
      });
      await db.runbookExecution.update({
        where: { id: s.executionId },
        data: { inputValues: { environment: 'changed after review' } },
      });
      await expect(commit(f, prepared)).rejects.toThrow('MCP_DOMAIN_REJECTED');
      expect(await step(s)).toMatchObject({ status: 'WAITING_APPROVAL', approvedAt: null });
      expect((await execution(s)).status).toBe('WAITING_APPROVAL');
    }
  );
});

describe('step decisions keep native separation and control rules', () => {
  // The routes resolve the execution through runbookExecutionReadWhere, so runbooks:read is required.
  it.each(['approveRunbookExecutionStep', 'rejectRunbookExecutionStep', 'rerunRunbookExecution'])(
    '%s: fails closed for a token without runbooks:read',
    async operationId => {
      const f = await fixture();
      const operation = MCP_OPERATION_MAP.get(operationId)!;
      expect(operation.requiredScopes).toContain('runbooks:read');
      const s = await waitingExecution(f);
      const args =
        operationId === 'rerunRunbookExecution'
          ? {
              path: { id: s.executionId },
              body: {
                expectedPlanDigest: 'a'.repeat(64),
                previewAuthorizationToken: 'b'.repeat(64),
              },
            }
          : {
              path: { id: s.executionId, stepId: s.stepId },
              body: {
                planDigest: s.planDigest,
                ...(operationId === 'rejectRunbookExecutionStep' ? { reason: 'Reviewed' } : {}),
              },
            };
      // A separate grant whose token omits runbooks:read; shared fixtures stay untouched.
      const narrow = await withoutRead(f);
      await expect(
        prepareMcpOperation(narrow.ctx(), { operationId, args, idempotencyKey: prepareKey() })
      ).rejects.toThrow('MCP_OPERATION_FORBIDDEN');
      // An approval prepared with full scopes is still refused if the committing token lost the scope.
      const prepared = await approved(f, operationId, args);
      const lostScope = {
        ...f.ctx(),
        tokenScopes: f.ctx().tokenScopes.filter(scope => scope !== 'runbooks:read'),
      };
      await expect(
        commitApprovedMcpOperation(lostScope, { approvalId: prepared.approvalId })
      ).rejects.toThrow('MCP_OPERATION_FORBIDDEN');
      expect(await step(s)).toMatchObject({ status: 'WAITING_APPROVAL', approvedAt: null });
      expect((await execution(s)).status).toBe('WAITING_APPROVAL');
      expect(await runCount(s)).toBe(1);
      expect(await approvalStatus(prepared)).not.toBe('COMMITTED');
    }
  );

  it('never lets the requester who started the run review their own step decision', async () => {
    const f = await fixture();
    const s = await waitingExecution(f, f.user.id);
    for (const operationId of ['approveRunbookExecutionStep', 'rejectRunbookExecutionStep']) {
      const prepared = await prepareMcpOperation(f.ctx(), {
        operationId,
        args: {
          path: { id: s.executionId, stepId: s.stepId },
          body: {
            planDigest: s.planDigest,
            ...(operationId === 'rejectRunbookExecutionStep' ? { reason: 'Self review' } : {}),
          },
        },
        idempotencyKey: prepareKey(),
      });
      await expect(f.review(prepared, 'approve', f.user)).rejects.toThrow(
        'MCP_DISTINCT_REVIEWER_REQUIRED'
      );
      await expect(commit(f, prepared)).rejects.toThrow('MCP_APPROVAL_REQUIRED');
    }
    expect(await step(s)).toMatchObject({ status: 'WAITING_APPROVAL', approvedAt: null });
  });

  it('attributes the native step approval to the requester, not the MCP reviewer', async () => {
    const f = await fixture();
    const s = await waitingExecution(f);
    const prepared = await approved(f, 'approveRunbookExecutionStep', {
      path: { id: s.executionId, stepId: s.stepId },
      body: { planDigest: s.planDigest },
    });
    await commit(f, prepared);
    expect((await step(s)).approvedById).toBe(f.user.id);
    expect(
      await db.auditLog.findMany({
        where: { entityId: s.executionId, action: 'runbook.execution.step.approved' },
        select: { actorId: true },
      })
    ).toEqual([{ actorId: f.user.id }]);
  });

  it('still requires native execution control from a non-administrator requester', async () => {
    const f = await fixture();
    const owner = await createTestUser({ role: 'RESPONDER' });
    const s = await waitingExecution(f, owner.id);
    // The requester can approve runbook steps but neither started this run nor owns its service.
    await db.user.update({ where: { id: f.user.id }, data: { role: 'RESPONDER' } });
    const prepared = await approved(f, 'approveRunbookExecutionStep', {
      path: { id: s.executionId, stepId: s.stepId },
      body: { planDigest: s.planDigest },
    });
    await expect(commit(f, prepared)).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    expect(await step(s)).toMatchObject({ status: 'WAITING_APPROVAL', approvedAt: null });
  });
});

describe('rerun keeps the native preview and execution policy', () => {
  it('withholds the preview capability from the review summary and stored approval', async () => {
    const f = await fixture();
    const s = await finishedRunWithPreview(f);
    const prepared = await prepareMcpOperation(f.ctx(), {
      operationId: 'rerunRunbookExecution',
      args: rerunArgs(s),
      idempotencyKey: prepareKey(),
    });
    const row = await db.mcpOperationApproval.findUniqueOrThrow({
      where: { id: prepared.approvalId },
    });
    expect(JSON.stringify(row)).not.toContain(s.token);
    expect(JSON.stringify(prepared)).not.toContain(s.token);
    expect(JSON.stringify(row.summary)).toContain('[withheld]');
    expect(JSON.stringify(row.summary)).toContain(s.digest);
  });

  it('starts exactly one execution per preview, however often the approval is replayed', async () => {
    const f = await fixture();
    const s = await finishedRunWithPreview(f);
    const first = await approved(f, 'rerunRunbookExecution', rerunArgs(s));
    await expect(commit(f, first)).resolves.toMatchObject({ status: 'COMMITTED' });
    const started = await db.runbookExecution.findFirstOrThrow({
      where: { runbookId: s.runbookId, id: { not: s.executionId } },
    });
    for (let i = 0; i < 3; i++) {
      const replay = await commit(f, first);
      expect(replay).toMatchObject({ status: 'COMMITTED' });
      expect(JSON.stringify(replay)).toContain(started.id);
    }
    expect(await runCount(s)).toBe(2);
    expect(started).toMatchObject({ triggeredByUserId: f.user.id, triggeredByType: 'USER' });
    expect(
      await db.runbookPreviewAuthorization.findMany({
        where: { actorId: f.user.id, runbookId: s.runbookId },
        select: { executionId: true },
      })
    ).toEqual([{ executionId: started.id }]);
    // A second, separately approved request cannot reuse the consumed preview.
    const second = await approved(f, 'rerunRunbookExecution', rerunArgs(s));
    await expect(commit(f, second)).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await runCount(s)).toBe(2);
  });

  it('refuses an unknown preview capability before starting work', async () => {
    const f = await fixture();
    const s = await finishedRunWithPreview(f);
    const prepared = await approved(
      f,
      'rerunRunbookExecution',
      rerunArgs(s, randomBytes(32).toString('hex'))
    );
    await expect(commit(f, prepared)).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await runCount(s)).toBe(1);
    expect(await approvalStatus(prepared)).toBe('FAILED');
  });

  it('refuses a plan that changed after review (new published version)', async () => {
    const f = await fixture();
    const s = await finishedRunWithPreview(f);
    const prepared = await approved(f, 'rerunRunbookExecution', rerunArgs(s));
    await publishDraftVersion((await cloneVersionToDraft(s.versionId, f.user.id)).id, f.user.id);
    await expect(commit(f, prepared)).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await runCount(s)).toBe(1);
  });

  it('refuses a rerun of an archived runbook or an unfinished execution', async () => {
    const f = await fixture();
    const archived = await finishedRunWithPreview(f);
    const prepared = await approved(f, 'rerunRunbookExecution', rerunArgs(archived));
    await archiveRunbook(archived.runbookId, f.user.id);
    await expect(commit(f, prepared)).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await runCount(archived)).toBe(1);

    const running = await finishedRunWithPreview(f);
    const again = await approved(f, 'rerunRunbookExecution', rerunArgs(running));
    await db.runbookExecution.update({
      where: { id: running.executionId },
      data: { status: 'RUNNING', completedAt: null },
    });
    await expect(commit(f, again)).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await runCount(running)).toBe(1);
  });
});
