import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { decideMcpRunbookReview, prepareMcpRunbook } from '@/lib/mcp/approvals/runbook';
import { MCP_REVIEWED_RUNBOOK_SCOPES } from '@/lib/mcp/approvals/policy';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { CostBudget } from '@/lib/mcp/core/budget';
import {
  APPROVAL_TASK_GRACE_MS,
  APPROVAL_TASK_POLL_INTERVAL_MS,
  cleanupExpiredMcpTasks,
  getMcpTask,
} from '@/lib/mcp/protocol/tasks';
import { POST } from '@/app/mcp/route';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  const policy = { enabled: true, writesEnabled: true, requestsPerMinute: 600 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

const scopes = [...MCP_REVIEWED_RUNBOOK_SCOPES];
async function connect(userId: string, tokenVersion: number) {
  const client = await db.mcpClient.create({
    data: { name: 'Tasks client', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId,
      userTokenVersion: tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { grant, token, bearer };
}

let rpcId = 0;
function call(bearer: string, method: string, params: Record<string, unknown>, tasks = true) {
  return POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': tasks
              ? { extensions: { 'io.modelcontextprotocol/tasks': {} } }
              : {},
            'io.modelcontextprotocol/clientInfo': { name: 'tasks-test', version: '1' },
          },
        },
      }),
    })
  ).then(response => response.json());
}

/** A runbook plan waiting for review, prepared through the real workflow. */
async function pendingRunbookApproval(key = 'prepare-pending') {
  const user = await createTestUser({ role: 'ADMIN' });
  const reviewer = await createTestUser({ role: 'ADMIN' });
  const connection = await connect(user.id, user.tokenVersion);
  const runbook = await createRunbook(
    {
      name: 'Approval-wait runbook',
      slug: `approval-wait-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [{ key: 'wait', name: 'Wait', type: 'WAIT', config: { durationSeconds: 60 } }],
      },
    },
    user.id
  );
  await publishDraftVersion(runbook.draftVersionId!, user.id);
  const context = {
    grantId: connection.grant.id,
    credentialId: connection.token.id,
    tokenScopes: scopes,
    requestId: 'tasks-test',
    budget: new CostBudget(),
  };
  const prepared = await prepareMcpRunbook(context, {
    runbookId: runbook.id,
    body: { parameters: {} },
    idempotencyKey: key,
  });
  return { user, reviewer, context, ...connection, prepared };
}

async function approvedExecution() {
  const user = await createTestUser({ role: 'ADMIN' });
  const reviewer = await createTestUser({ role: 'ADMIN' });
  const connection = await connect(user.id, user.tokenVersion);
  const runbook = await createRunbook(
    {
      name: 'Task-backed runbook',
      slug: `task-runbook-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [{ key: 'wait', name: 'Wait', type: 'WAIT', config: { durationSeconds: 60 } }],
      },
    },
    user.id
  );
  await publishDraftVersion(runbook.draftVersionId!, user.id);
  const prepared = await prepareMcpRunbook(
    {
      grantId: connection.grant.id,
      credentialId: connection.token.id,
      tokenScopes: scopes,
      requestId: 'tasks-test',
      budget: new CostBudget(),
    },
    { runbookId: runbook.id, body: { parameters: {} }, idempotencyKey: 'prepare-task' }
  );
  await decideMcpRunbookReview(
    { id: prepared.previewId, planDigest: prepared.planDigest, decision: 'approve' },
    reviewer
  );
  return { user, reviewer, ...connection, previewId: prepared.previewId };
}

describe('Tasks extension (io.modelcontextprotocol/tasks)', () => {
  it('advertises the extension in discovery', async () => {
    const f = await approvedExecution();
    const discover = await call(f.bearer, 'server/discover', {});
    expect(discover.result.capabilities.extensions).toHaveProperty('io.modelcontextprotocol/tasks');
  });

  it('returns a durable task handle only when the request opts in, and polls the real execution', async () => {
    const f = await approvedExecution();
    const args = { previewId: f.previewId, idempotencyKey: 'execute-task' };
    const created = await call(f.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: args,
    });
    expect(created.error).toBeUndefined();
    expect(created.result).toMatchObject({
      resultType: 'task',
      status: 'working',
      ttlMs: 24 * 3600_000,
      pollIntervalMs: 5000,
    });
    const taskId = created.result.taskId as string;
    // Durably created before the handle was returned.
    expect(await db.mcpTask.findUnique({ where: { id: taskId } })).not.toBeNull();
    const polled = await call(f.bearer, 'tasks/get', { taskId });
    expect(polled.result).toMatchObject({ resultType: 'complete', taskId, status: 'working' });
    const task = await db.mcpTask.findUniqueOrThrow({ where: { id: taskId } });
    await db.runbookExecution.update({
      where: { id: task.resourceId },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
    const done = await call(f.bearer, 'tasks/get', { taskId });
    expect(done.result).toMatchObject({ status: 'completed', result: { isError: false } });
    expect(done.result.result.structuredContent).toMatchObject({
      executionId: task.resourceId,
      status: 'SUCCEEDED',
    });
    // A retry without the extension gets the ordinary synchronous replay, never a task.
    const plain = await call(
      f.bearer,
      'tools/call',
      { name: 'runbook_execute_approved', arguments: args },
      false
    );
    expect(plain.result.resultType).not.toBe('task');
    expect(plain.result.structuredContent.executionId).toBe(task.resourceId);
  });

  it('reports a failed runbook as a completed tool error, not a JSON-RPC failure', async () => {
    const f = await approvedExecution();
    const created = await call(f.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: { previewId: f.previewId, idempotencyKey: 'execute-fail' },
    });
    const task = await db.mcpTask.findUniqueOrThrow({ where: { id: created.result.taskId } });
    await db.runbookExecution.update({
      where: { id: task.resourceId },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    const polled = await call(f.bearer, 'tasks/get', { taskId: task.id });
    expect(polled.result).toMatchObject({ status: 'completed', result: { isError: true } });
  });

  it('cancels cooperatively through the native command and never claims to undo finished work', async () => {
    const f = await approvedExecution();
    const created = await call(f.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: { previewId: f.previewId, idempotencyKey: 'execute-cancel' },
    });
    const taskId = created.result.taskId as string;
    const ack = await call(f.bearer, 'tasks/cancel', { taskId });
    expect(ack.result).toEqual({ resultType: 'complete' });
    const task = await db.mcpTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.cancelRequestedAt).not.toBeNull();
    const execution = await db.runbookExecution.findUniqueOrThrow({
      where: { id: task.resourceId },
    });
    expect(['CANCEL_REQUESTED', 'CANCELLED']).toContain(execution.status);
    // Repeating is a replay of the same durable cancel, not a second command.
    expect((await call(f.bearer, 'tasks/cancel', { taskId })).result).toEqual({
      resultType: 'complete',
    });
    expect(
      await db.auditLog.count({
        where: { entityId: task.resourceId, action: { contains: 'cancel' } },
      })
    ).toBeLessThanOrEqual(1);

    const finished = await approvedExecution();
    const second = await call(finished.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: { previewId: finished.previewId, idempotencyKey: 'execute-finished' },
    });
    const finishedTask = await db.mcpTask.findUniqueOrThrow({
      where: { id: second.result.taskId },
    });
    await db.runbookExecution.update({
      where: { id: finishedTask.resourceId },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
    expect(
      (await call(finished.bearer, 'tasks/cancel', { taskId: finishedTask.id })).result
    ).toEqual({ resultType: 'complete' });
    expect(
      (await call(finished.bearer, 'tasks/get', { taskId: finishedTask.id })).result.status
    ).toBe('completed');
  });

  it('hides foreign, unknown and expired tasks identically and reauthorizes every poll', async () => {
    const f = await approvedExecution();
    const created = await call(f.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: { previewId: f.previewId, idempotencyKey: 'execute-scope' },
    });
    const taskId = created.result.taskId as string;
    const other = await connect(f.user.id, f.user.tokenVersion);
    const foreign = await call(other.bearer, 'tasks/get', { taskId });
    const unknown = await call(f.bearer, 'tasks/get', { taskId: 'x'.repeat(40) });
    const malformed = await call(f.bearer, 'tasks/get', { taskId: '../../etc' });
    expect(foreign.error).toEqual(unknown.error);
    expect(malformed.error).toEqual(unknown.error);
    expect(foreign.error.code).toBe(-32602);
    expect((await call(other.bearer, 'tasks/cancel', { taskId })).error).toEqual(unknown.error);

    await db.mcpTask.update({
      where: { id: taskId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await call(f.bearer, 'tasks/get', { taskId })).error).toEqual(unknown.error);
    expect(await cleanupExpiredMcpTasks()).toBeGreaterThanOrEqual(1);
    expect(await db.mcpTask.findUnique({ where: { id: taskId } })).toBeNull();

    const revoked = await approvedExecution();
    const live = await call(revoked.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: { previewId: revoked.previewId, idempotencyKey: 'execute-revoked' },
    });
    await db.mcpGrant.update({ where: { id: revoked.grant.id }, data: { revokedAt: new Date() } });
    const after = await POST(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${revoked.bearer}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tasks/get',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'tasks/get',
          params: {
            taskId: live.result.taskId,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {
                extensions: { 'io.modelcontextprotocol/tasks': {} },
              },
              'io.modelcontextprotocol/clientInfo': { name: 'tasks-test', version: '1' },
            },
          },
        }),
      })
    );
    expect(after.status).toBe(401);
  });

  it('requires the client capability for task methods and acknowledges updates without input', async () => {
    const f = await approvedExecution();
    const missing = await call(f.bearer, 'tasks/get', { taskId: 'x'.repeat(40) }, false);
    expect(missing.error).toMatchObject({
      code: -32021,
      data: { requiredCapabilities: { extensions: { 'io.modelcontextprotocol/tasks': {} } } },
    });
    const created = await call(f.bearer, 'tools/call', {
      name: 'runbook_execute_approved',
      arguments: { previewId: f.previewId, idempotencyKey: 'execute-update' },
    });
    const update = await call(f.bearer, 'tasks/update', {
      taskId: created.result.taskId,
      inputResponses: { never: { action: 'accept' } },
    });
    expect(update.result).toEqual({ resultType: 'complete' });
  });

  describe('approval waits (TQ-14b / D7)', () => {
    const wait = (bearer: string, previewId: string, tasks = true) =>
      call(bearer, 'tools/call', { name: 'runbook_get_approval', arguments: { previewId } }, tasks);

    it('parks a PENDING approval as a task that follows the human decision', async () => {
      const f = await pendingRunbookApproval();
      const created = await wait(f.bearer, f.prepared.previewId);
      expect(created.result).toMatchObject({
        resultType: 'task',
        status: 'working',
        statusMessage: 'Waiting for review in OpsKnight; not client input.',
      });
      const task = await db.mcpTask.findUniqueOrThrow({ where: { id: created.result.taskId } });
      expect(task).toMatchObject({
        kind: 'RUNBOOK_APPROVAL',
        toolName: 'runbook_get_approval',
        resourceId: f.prepared.previewId,
      });
      // Ends a short grace after the review deadline, so a last-moment outcome still arrives.
      const preview = await db.runbookPreviewAuthorization.findUniqueOrThrow({
        where: { id: f.prepared.previewId },
      });
      expect(task.expiresAt.getTime()).toBe(preview.expiresAt.getTime() + APPROVAL_TASK_GRACE_MS);
      expect(created.result.ttlMs).toBe(task.expiresAt.getTime() - task.createdAt.getTime());
      // A human review is polled at the backoff's opening interval, not the runner's.
      expect(created.result.pollIntervalMs).toBe(APPROVAL_TASK_POLL_INTERVAL_MS);
      const working = await call(f.bearer, 'tasks/get', { taskId: task.id });
      expect(working.result).toMatchObject({ status: 'working' });
      await decideMcpRunbookReview(
        { id: f.prepared.previewId, planDigest: f.prepared.planDigest, decision: 'approve' },
        f.reviewer
      );
      const done = await call(f.bearer, 'tasks/get', { taskId: task.id });
      expect(done.result).toMatchObject({
        status: 'completed',
        result: {
          isError: false,
          structuredContent: { status: 'APPROVED', next: 'runbook_execute_approved' },
        },
      });
      expect(done.result.result.structuredContent.commitDeadline).toEqual(expect.any(String));
    });

    it('hands back the live task when the tool is polled again instead of adding rows', async () => {
      const f = await pendingRunbookApproval('prepare-repoll');
      const first = await wait(f.bearer, f.prepared.previewId);
      const again = await wait(f.bearer, f.prepared.previewId);
      expect(again.result).toMatchObject({ resultType: 'task', status: 'working' });
      expect(again.result.taskId).toBe(first.result.taskId);
      expect(await db.mcpTask.count({ where: { resourceId: f.prepared.previewId } })).toBe(1);
      // A cancelled wait is not revived: observing again starts a new task.
      await call(f.bearer, 'tasks/cancel', { taskId: first.result.taskId });
      const fresh = await wait(f.bearer, f.prepared.previewId);
      expect(fresh.result.taskId).not.toBe(first.result.taskId);
    });

    it('completes, not fails, on a rejection or an expiry', async () => {
      const rejected = await pendingRunbookApproval('prepare-reject');
      const first = await wait(rejected.bearer, rejected.prepared.previewId);
      await decideMcpRunbookReview(
        {
          id: rejected.prepared.previewId,
          planDigest: rejected.prepared.planDigest,
          decision: 'reject',
        },
        rejected.reviewer
      );
      expect(
        (await call(rejected.bearer, 'tasks/get', { taskId: first.result.taskId })).result
      ).toMatchObject({
        status: 'completed',
        result: { isError: false, structuredContent: { status: 'REJECTED' } },
      });

      const lapsed = await pendingRunbookApproval('prepare-expire');
      const second = await wait(lapsed.bearer, lapsed.prepared.previewId);
      // Time passes for both records: the review deadline is a second ago, and the task's own
      // expiry moves back by the same amount, as it would have on a real clock.
      const before = await db.runbookPreviewAuthorization.findUniqueOrThrow({
        where: { id: lapsed.prepared.previewId },
      });
      const shift = before.expiresAt.getTime() - (Date.now() - 1000);
      await db.runbookPreviewAuthorization.update({
        where: { id: lapsed.prepared.previewId },
        data: { expiresAt: new Date(before.expiresAt.getTime() - shift) },
      });
      const parked = await db.mcpTask.findUniqueOrThrow({ where: { id: second.result.taskId } });
      await db.mcpTask.update({
        where: { id: parked.id },
        data: {
          createdAt: new Date(parked.createdAt.getTime() - shift),
          expiresAt: new Date(parked.expiresAt.getTime() - shift),
        },
      });
      expect(
        (await call(lapsed.bearer, 'tasks/get', { taskId: second.result.taskId })).result
      ).toMatchObject({
        status: 'completed',
        result: { isError: false, structuredContent: { status: 'EXPIRED' } },
      });
    });

    it('answers synchronously when the approval is already decided, or without the extension', async () => {
      const f = await pendingRunbookApproval('prepare-sync');
      const plain = await wait(f.bearer, f.prepared.previewId, false);
      expect(plain.result.resultType).not.toBe('task');
      expect(plain.result.structuredContent.status).toBe('PENDING');
      expect(plain.result.structuredContent.poll).toMatchObject({ afterSeconds: 30 });
      await decideMcpRunbookReview(
        { id: f.prepared.previewId, planDigest: f.prepared.planDigest, decision: 'approve' },
        f.reviewer
      );
      const decided = await wait(f.bearer, f.prepared.previewId);
      expect(decided.result.resultType).not.toBe('task');
      expect(decided.result.structuredContent.status).toBe('APPROVED');
      expect(await db.mcpTask.count({ where: { resourceId: f.prepared.previewId } })).toBe(0);
    });

    it('hides the task from another grant and from a requester who lost access', async () => {
      const f = await pendingRunbookApproval('prepare-foreign');
      const created = await wait(f.bearer, f.prepared.previewId);
      const other = await connect(f.user.id, f.user.tokenVersion);
      expect(
        (await call(other.bearer, 'tasks/get', { taskId: created.result.taskId })).error.code
      ).toBe(-32602);
      // The approval moved to another requester: the same reader refuses, so the task is gone.
      await db.runbookPreviewAuthorization.update({
        where: { id: f.prepared.previewId },
        data: { actorId: f.reviewer.id },
      });
      expect(
        (await call(f.bearer, 'tasks/get', { taskId: created.result.taskId })).error.code
      ).toBe(-32602);
    });

    it('stops observing on cancel without withdrawing or deciding the approval', async () => {
      const f = await pendingRunbookApproval('prepare-cancel');
      const created = await wait(f.bearer, f.prepared.previewId);
      const ack = await call(f.bearer, 'tasks/cancel', { taskId: created.result.taskId });
      expect(ack.result).toEqual({ resultType: 'complete' });
      const preview = await db.runbookPreviewAuthorization.findUniqueOrThrow({
        where: { id: f.prepared.previewId },
      });
      expect(preview).toMatchObject({ reviewedAt: null, rejectedAt: null, consumedAt: null });
      expect(
        (await call(f.bearer, 'tasks/get', { taskId: created.result.taskId })).result.status
      ).toBe('cancelled');
      // The person can still approve it, and the assistant can still read it.
      await decideMcpRunbookReview(
        { id: f.prepared.previewId, planDigest: f.prepared.planDigest, decision: 'approve' },
        f.reviewer
      );
      expect(
        (await wait(f.bearer, f.prepared.previewId, false)).result.structuredContent.status
      ).toBe('APPROVED');
    });

    it('re-reads an operation approval through its own reader', async () => {
      const f = await pendingRunbookApproval('prepare-operation');
      const approval = await db.mcpOperationApproval.create({
        data: {
          operationId: 'updateService',
          riskClass: 'R2',
          operationDigest: 'a'.repeat(64),
          contractDigest: 'b'.repeat(64),
          actorId: f.user.id,
          requesterGrantId: f.grant.id,
          requesterCredentialId: f.token.id,
          summary: {},
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const task = await db.mcpTask.create({
        data: {
          id: randomBytes(24).toString('base64url'),
          grantId: f.grant.id,
          credentialId: f.token.id,
          actorId: f.user.id,
          toolName: 'operation_get_approval',
          kind: 'OPERATION_APPROVAL',
          resourceId: approval.id,
          expiresAt: approval.expiresAt,
        },
      });
      const context = { ...f.context, budget: new CostBudget() };
      expect(await getMcpTask(context, task.id)).toMatchObject({ status: 'working' });
      await db.mcpOperationApproval.update({
        where: { id: approval.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });
      expect(await getMcpTask({ ...context, budget: new CostBudget() }, task.id)).toMatchObject({
        status: 'completed',
        result: { isError: false, structuredContent: { status: 'REJECTED' } },
      });
    });
  });
});
