import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as audit from '@/lib/audit';
import {
  createRunbook,
  publishDraftVersion,
  cloneVersionToDraft,
  updateDraftVersion,
} from '@/lib/runbooks/versioning';
import { startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { decrypt } from '@/lib/encryption';
import {
  prepareMcpRunbook,
  executeApprovedMcpRunbook,
  decideMcpRunbookReview,
  loadMcpRunbookReview,
} from '@/lib/mcp/approvals/runbook';
import { MCP_REVIEWED_RUNBOOK_SCOPES } from '@/lib/mcp/approvals/policy';
import { mcpResource, digestMcpSecret } from '@/lib/mcp/auth/config';
import { CostBudget } from '@/lib/mcp/core/budget';
import type { ExecutionContext } from '@/lib/mcp/core/execution';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

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
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, writesEnabled: true },
    update: { enabled: true, writesEnabled: true },
  });
});

async function fixture(stepApproval = false) {
  const user = await createTestUser({ role: 'ADMIN' });
  const reviewer = await createTestUser({ role: 'ADMIN' });
  const scopes = [...MCP_REVIEWED_RUNBOOK_SCOPES];
  const client = await db.mcpClient.create({
    data: { name: 'Reviewed runbooks', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(randomBytes(32).toString('hex')),
      refreshHash: digestMcpSecret(randomBytes(32).toString('hex')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const runbook = await createRunbook(
    {
      name: 'Independently reviewed workflow',
      slug: `mcp-review-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [
          {
            key: 'wait',
            name: 'Wait briefly',
            type: 'WAIT',
            config: { durationSeconds: 1 },
            requiresApproval: stepApproval,
          },
        ],
      },
      inputs: [
        {
          key: 'note',
          label: 'Note',
          type: 'STRING',
          required: false,
          description: '',
          sequence: 0,
        },
      ],
    },
    user.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, user.id);
  const ctx = (): ExecutionContext => ({
    grantId: grant.id,
    credentialId: token.id,
    tokenScopes: scopes,
    requestId: 'local-reviewed-runbook',
    budget: new CostBudget(),
  });
  const input = {
    runbookId: runbook.id,
    body: { parameters: { note: 'private review input' } },
    idempotencyKey: 'prepare',
  };
  const prepare = () => prepareMcpRunbook(ctx(), input);
  return { user, reviewer, client, grant, token, runbook, version, ctx, input, prepare };
}
async function approved(f: Awaited<ReturnType<typeof fixture>>) {
  const prepared = await f.prepare();
  await decideMcpRunbookReview(
    { id: prepared.previewId, planDigest: prepared.planDigest, decision: 'approve' },
    f.reviewer
  );
  return {
    ...prepared,
    execute: () =>
      executeApprovedMcpRunbook(f.ctx(), {
        previewId: prepared.previewId,
        idempotencyKey: 'execute',
      }),
  };
}

describe('independently reviewed MCP runbook execution', () => {
  it('rejects a newly published version instead of silently executing a changed plan', async () => {
    const f = await fixture();
    const p = await approved(f);
    const draft = await cloneVersionToDraft(f.version.id, f.user.id);
    await updateDraftVersion(
      draft.id,
      {
        expectedDraftRevision: draft.draftRevision,
        definition: {
          steps: [
            { key: 'wait', name: 'Wait longer', type: 'WAIT', config: { durationSeconds: 2 } },
          ],
        },
        inputs: [
          {
            key: 'note',
            label: 'Note',
            type: 'STRING',
            required: false,
            description: '',
            sequence: 0,
          },
        ],
      },
      f.user.id
    );
    await publishDraftVersion(draft.id, f.user.id);
    await expect(p.execute()).rejects.toThrow('PREVIEW_STALE');
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(0);
  });
  it('uses native responder approval capabilities without requiring an MCP administrator', async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.reviewer.id }, data: { role: 'RESPONDER' } });
    const p = await approved(f);
    expect((await p.execute()).executionId).toBeTruthy();
  });
  it('rolls back execution, consumption, audit and advance job on a pre-commit failure', async () => {
    const f = await fixture();
    const p = await approved(f);
    const jobsBefore = await db.backgroundJob.count();
    const auditsBefore = await db.auditLog.count();
    const log = audit.logAudit;
    const fail = vi.spyOn(audit, 'logAudit').mockImplementation(async (entry, tx) => {
      if (entry.action === 'mcp.runbook.committed') throw new Error('Simulated pre-commit crash');
      return log(entry, tx);
    });
    try {
      await expect(p.execute()).rejects.toThrow('Simulated pre-commit crash');
    } finally {
      fail.mockRestore();
    }
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(0);
    const row = await db.runbookPreviewAuthorization.findUniqueOrThrow({
      where: { id: p.previewId },
    });
    expect(row.consumedAt).toBeNull();
    expect(row.requestEnvelope).not.toBeNull();
    expect(await db.backgroundJob.count()).toBe(jobsBefore);
    expect(await db.auditLog.count()).toBe(auditsBefore);
    const execution = await p.execute();
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'runbook.execution.started', entityId: execution.executionId },
      })
    ).toBe(1);
  });
  it('accepts a newly rotated credential only within the same current grant and scopes', async () => {
    const f = await fixture();
    const p = await f.prepare();
    await db.mcpToken.update({ where: { id: f.token.id }, data: { rotatedAt: new Date() } });
    const token = await db.mcpToken.create({
      data: {
        grantId: f.grant.id,
        scopes: [...f.ctx().tokenScopes],
        accessHash: digestMcpSecret(randomBytes(32).toString('hex')),
        refreshHash: digestMcpSecret(randomBytes(32).toString('hex')),
        accessExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    await decideMcpRunbookReview(
      { id: p.previewId, planDigest: p.planDigest, decision: 'approve' },
      f.reviewer
    );
    await expect(
      executeApprovedMcpRunbook(f.ctx(), { previewId: p.previewId, idempotencyKey: 'execute' })
    ).rejects.toThrow('MCP_INVALID_GRANT');
    const result = await executeApprovedMcpRunbook(
      { ...f.ctx(), credentialId: token.id },
      {
        previewId: p.previewId,
        idempotencyKey: 'execute',
      }
    );
    expect(result.executionId).toBeTruthy();
  });
  it('preserves the published runbook step approval policy after native plan approval', async () => {
    const f = await fixture(true);
    const p = await approved(f);
    const result = await p.execute();
    const steps = await db.runbookExecutionStep.findMany({
      where: { executionId: result.executionId },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].requiresApproval).toBe(true);
    expect(steps[0].approvedAt).toBeNull();
  });
  it('freezes one native preview without an execution/job or plaintext disclosure', async () => {
    const f = await fixture();
    const jobs = await db.backgroundJob.count({ where: { status: { not: 'COMPLETED' } } });
    const prepared = await f.prepare();
    expect(await f.prepare()).toEqual(prepared);
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(0);
    expect(await db.backgroundJob.count({ where: { status: { not: 'COMPLETED' } } })).toBe(jobs);
    const stored = await db.runbookPreviewAuthorization.findUniqueOrThrow({
      where: { id: prepared.previewId },
    });
    expect(stored.independentReview).toBe(true);
    expect(stored.requestEnvelope).toMatch(/^v3:/);
    expect(JSON.stringify(stored)).not.toContain('private review input');
    expect(JSON.stringify(prepared)).not.toContain('authorizationToken');
    const reviewed = await loadMcpRunbookReview(prepared.previewId, f.reviewer);
    expect(reviewed.summary.versionId).toBe(f.version.id);
    expect(JSON.stringify(reviewed.summary)).not.toContain('private review input');
  });
  it('requires approval from a different native actor before execution', async () => {
    const f = await fixture();
    const p = await f.prepare();
    await expect(
      executeApprovedMcpRunbook(f.ctx(), { previewId: p.previewId, idempotencyKey: 'execute' })
    ).rejects.toThrow('MCP_APPROVAL_REQUIRED');
    await expect(
      decideMcpRunbookReview(
        { id: p.previewId, planDigest: p.planDigest, decision: 'approve' },
        f.user
      )
    ).rejects.toThrow('PREVIEW_REVIEW_DISTINCT_ACTOR_REQUIRED');
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(0);
  });
  it('commits one canonical execution and replays the result after a lost response', async () => {
    const f = await fixture();
    const p = await approved(f);
    const first = await p.execute();
    expect(await p.execute()).toEqual(first);
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'runbook.execution.started', entityId: first.executionId },
      })
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'runbook.preview.approved', entityId: f.runbook.id },
      })
    ).toBe(1);
    const stored = await db.runbookPreviewAuthorization.findUniqueOrThrow({
      where: { id: p.previewId },
    });
    expect(stored.consumedAt).not.toBeNull();
    expect(stored.executionId).toBe(first.executionId);
    expect(stored.requestEnvelope).toBeNull();
    await expect(
      executeApprovedMcpRunbook(f.ctx(), {
        previewId: p.previewId,
        idempotencyKey: 'different-key',
      })
    ).rejects.toThrow('MCP_APPROVAL_EXPIRED');
  });
  it('serializes competing approvals without duplicate decisions or audit effects', async () => {
    const f = await fixture();
    const p = await f.prepare();
    const second = await createTestUser({ role: 'ADMIN' });
    const decisions = await Promise.allSettled(
      [f.reviewer, second].map(reviewer =>
        decideMcpRunbookReview(
          { id: p.previewId, planDigest: p.planDigest, decision: 'approve' },
          reviewer
        )
      )
    );
    expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { action: 'runbook.preview.approved', entityId: f.runbook.id },
      })
    ).toBe(1);
  });
  it('serializes two concurrent commits into one execution and durable result', async () => {
    const f = await fixture();
    const p = await approved(f);
    const [a, b] = await Promise.all([p.execute(), p.execute()]);
    expect(a.executionId).toBe(b.executionId);
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(1);
  });
  it('rejects native decisions with a changed digest or stale session version', async () => {
    const f = await fixture();
    const p = await f.prepare();
    await expect(
      decideMcpRunbookReview(
        { id: p.previewId, planDigest: '0'.repeat(64), decision: 'approve' },
        f.reviewer
      )
    ).rejects.toThrow('PREVIEW_REVIEW_PLAN_CHANGED');
    await db.user.update({
      where: { id: f.reviewer.id },
      data: { tokenVersion: { increment: 1 } },
    });
    await expect(
      decideMcpRunbookReview(
        { id: p.previewId, planDigest: p.planDigest, decision: 'approve' },
        f.reviewer
      )
    ).rejects.toThrow('PREVIEW_REVIEW_APPROVER_CHANGED');
  });
  it('rechecks the reviewer capability at execution time', async () => {
    const f = await fixture();
    const p = await approved(f);
    await db.user.update({ where: { id: f.reviewer.id }, data: { role: 'USER' } });
    await expect(p.execute()).rejects.toThrow();
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(0);
  });
  it('rechecks requester scope and token revocation before execution', async () => {
    const f = await fixture();
    const p = await approved(f);
    await db.mcpClient.update({ where: { id: f.client.id }, data: { scopes: ['runbooks:read'] } });
    await expect(p.execute()).rejects.toThrow('MCP_OPERATION_FORBIDDEN');
    await db.mcpClient.update({
      where: { id: f.client.id },
      data: { scopes: f.ctx().tokenScopes as string[] },
    });
    await db.mcpToken.update({ where: { id: f.token.id }, data: { rotatedAt: new Date() } });
    await expect(p.execute()).rejects.toThrow('MCP_INVALID_GRANT');
  });
  it('does not accept another grant, modified action parameters or an expired proposal', async () => {
    const f = await fixture();
    const p = await approved(f);
    const other = await fixture();
    await expect(
      executeApprovedMcpRunbook(other.ctx(), { previewId: p.previewId, idempotencyKey: 'execute' })
    ).rejects.toThrow('MCP_APPROVAL_UNAVAILABLE');
    await expect(
      executeApprovedMcpRunbook(f.ctx(), {
        previewId: p.previewId,
        idempotencyKey: 'execute',
        body: {},
      })
    ).rejects.toThrow();
    await db.runbookPreviewAuthorization.update({
      where: { id: p.previewId },
      data: { expiresAt: new Date(0) },
    });
    await expect(p.execute()).rejects.toThrow('MCP_APPROVAL_EXPIRED');
  });
  it('rejects a denied plan and erases its encrypted request', async () => {
    const f = await fixture();
    const p = await f.prepare();
    await decideMcpRunbookReview(
      { id: p.previewId, planDigest: p.planDigest, decision: 'reject' },
      f.reviewer
    );
    await expect(
      executeApprovedMcpRunbook(f.ctx(), { previewId: p.previewId, idempotencyKey: 'execute' })
    ).rejects.toThrow('MCP_APPROVAL_REQUIRED');
    expect(
      (await db.runbookPreviewAuthorization.findUniqueOrThrow({ where: { id: p.previewId } }))
        .requestEnvelope
    ).toBeNull();
  });
  it('makes reviewed previews unusable through the ordinary execution entry point', async () => {
    const f = await fixture();
    const p = await approved(f);
    const row = await db.runbookPreviewAuthorization.findUniqueOrThrow({
      where: { id: p.previewId },
    });
    const envelope = JSON.parse(await decrypt(row.requestEnvelope!)) as {
      authorizationToken: string;
    };
    await expect(
      startRunbookExecution({
        runbookId: f.runbook.id,
        triggeredByUserId: f.user.id,
        inputValues: f.input.body.parameters,
        expectedPlanDigest: p.planDigest,
        previewAuthorizationToken: envelope.authorizationToken,
      })
    ).rejects.toThrow('PREVIEW_REVIEW_PROVENANCE_REQUIRED');
  });
  it('rejects a changed runbook version/context before consuming the approval', async () => {
    const f = await fixture();
    const p = await approved(f);
    await db.runbook.update({ where: { id: f.runbook.id }, data: { archivedAt: new Date() } });
    await expect(p.execute()).rejects.toThrow();
    expect(
      (await db.runbookPreviewAuthorization.findUniqueOrThrow({ where: { id: p.previewId } }))
        .consumedAt
    ).toBeNull();
    expect(await db.runbookExecution.count({ where: { runbookId: f.runbook.id } })).toBe(0);
  });
  it('honors the write kill switch before executing an approved request', async () => {
    const f = await fixture();
    const p = await approved(f);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    await expect(p.execute()).rejects.toThrow('MCP_OPERATION_DISABLED');
  });
});
