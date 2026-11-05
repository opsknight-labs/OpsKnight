import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import {
  commitApprovedMcpOperation,
  getMcpOperationApproval,
  loadMcpOperationRequest,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';
import {
  decideMcpRunbookReview,
  executeApprovedMcpRunbook,
  getMcpRunbookApproval,
  loadMcpRunbookRequest,
  prepareMcpRunbook,
} from '@/lib/mcp/approvals/runbook';
import { MCP_REVIEWED_RUNBOOK_SCOPES } from '@/lib/mcp/approvals/policy';
import { cleanupMcpCredentials, expireMcpApprovals } from '@/lib/mcp/auth/retention';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import type { ExecutionContext } from '@/lib/mcp/core/execution';

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
  // Earlier tests' people must not count as reviewers here.
  await db.user.updateMany({ data: { status: 'DISABLED' } });
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, writesEnabled: true, requestsPerMinute: 600 },
    update: {
      enabled: true,
      writesEnabled: true,
      requestsPerMinute: 600,
      approvalTtlMinutes: 240,
      approvalCommitWindowMinutes: 30,
    },
  });
});

const minutes = (n: number) => n * 60_000;
const near = (value: Date | string | null | undefined, expected: number, slack = 10_000) => {
  const at = value instanceof Date ? value.getTime() : new Date(value ?? 0).getTime();
  expect(Math.abs(at - expected)).toBeLessThan(slack);
};
const notificationsFor = (entityId: string) =>
  db.inAppNotification.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof McpBoundaryError) return { code: error.code, hint: error.hint };
    throw error;
  }
  throw new Error('expected a refusal');
}

async function runbookFixture() {
  const user = await createTestUser({ role: 'ADMIN', name: 'Rita Requester' });
  const reviewer = await createTestUser({ role: 'RESPONDER', name: 'Rob Responder' });
  const scopes = [...MCP_REVIEWED_RUNBOOK_SCOPES];
  const client = await db.mcpClient.create({
    data: { name: 'Runbook assistant', scopes, redirectUris: ['http://localhost/callback'] },
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
      name: 'Restart the gateway',
      slug: `mcp-lifecycle-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [{ key: 'wait', name: 'Wait', type: 'WAIT', config: { durationSeconds: 1 } }],
      },
      inputs: [],
    },
    user.id
  );
  await publishDraftVersion(runbook.draftVersionId!, user.id);
  const ctx = (): ExecutionContext => ({
    grantId: grant.id,
    credentialId: token.id,
    tokenScopes: scopes,
    requestId: 'approval-lifecycle',
    budget: new CostBudget(),
  });
  const key = `prepare-${randomBytes(6).toString('hex')}`;
  const prepare = () =>
    prepareMcpRunbook(ctx(), {
      runbookId: runbook.id,
      body: { parameters: {} },
      idempotencyKey: key,
    });
  return { user, reviewer, client, grant, token, runbook, ctx, prepare };
}

describe('C1 reviewers and requesters are notified in-app', () => {
  it('notifies eligible administrators, never the requester, without the frozen request', async () => {
    const f = await fixture();
    const responder = await createTestUser({ role: 'RESPONDER' });
    const disabledAdmin = await createTestUser({ role: 'ADMIN', status: 'DISABLED' });
    const input = f.announcementArgs('Quiet-title-that-must-not-leak');
    const prepared = await prepareMcpOperation(f.ctx(), input);
    const rows = await notificationsFor(prepared.approvalId);
    expect(rows.map(row => row.userId)).toEqual([f.reviewer.id]);
    expect(rows[0]).toMatchObject({
      type: 'SYSTEM',
      entityType: 'MCP_APPROVAL',
      title: 'Change waiting for your review',
    });
    expect(rows[0].message).toContain('"Approval client"');
    expect(rows[0].message).toContain('within 4 hours');
    expect(rows[0].message).not.toContain('Quiet-title-that-must-not-leak');
    for (const id of [f.user.id, responder.id, disabledAdmin.id])
      expect(rows.some(row => row.userId === id)).toBe(false);

    // A retried prepare replays the same approval and does not notify again.
    await prepareMcpOperation(f.ctx(), input);
    expect(await notificationsFor(prepared.approvalId)).toHaveLength(1);
  });

  it('tells the requester about the decision, but not when they decided it themselves', async () => {
    const f = await fixture();
    const other = await createTestUser({ role: 'ADMIN' });
    const approved = await prepareMcpOperation(f.ctx(), f.announcementArgs('First'));
    await f.review(approved, 'approve');
    const mine = (id: string) =>
      db.inAppNotification.findMany({ where: { entityId: id, userId: f.user.id } });
    expect((await mine(approved.approvalId)).map(row => row.title)).toEqual([
      'Your change was approved',
    ]);
    const rejected = await prepareMcpOperation(f.ctx(), f.announcementArgs('Second'));
    await f.review(rejected, 'reject', other);
    expect((await mine(rejected.approvalId)).map(row => row.title)).toEqual([
      'Your change was rejected',
    ]);
    const self = await prepareMcpOperation(f.ctx(), f.announcementArgs('Third'));
    await f.review(self, 'reject', f.user);
    expect(await mine(self.approvalId)).toHaveLength(0);
  });

  it('notifies runbook approvers (responders and administrators) other than the requester', async () => {
    const f = await runbookFixture();
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser({ role: 'USER' });
    const auditor = await createTestUser({ role: 'AUDITOR' });
    const prepared = await f.prepare();
    const rows = await notificationsFor(prepared.previewId);
    expect(rows.map(row => row.userId).sort()).toEqual([f.reviewer.id, admin.id].sort());
    expect(rows[0].message).toContain('"Restart the gateway"');
    for (const id of [f.user.id, user.id, auditor.id])
      expect(rows.some(row => row.userId === id)).toBe(false);
    await decideMcpRunbookReview(
      { id: prepared.previewId, planDigest: prepared.planDigest, decision: 'approve' },
      f.reviewer
    );
    expect(
      (
        await db.inAppNotification.findMany({
          where: { entityId: prepared.previewId, userId: f.user.id },
        })
      ).map(row => row.title)
    ).toEqual(['Your runbook run was approved']);
  });

  it('writes nothing when the prepare transaction fails', async () => {
    const f = await fixture();
    for (let index = 0; index < 20; index++)
      await prepareMcpOperation(f.ctx(), f.announcementArgs(`Notice ${index}`));
    const before = await db.inAppNotification.count();
    await expect(prepareMcpOperation(f.ctx(), f.announcementArgs('Overflow'))).rejects.toThrow(
      'MCP_APPROVAL_BACKLOG'
    );
    expect(await db.inAppNotification.count()).toBe(before);
  });
});

describe('C1 notifications never leave OpsKnight', () => {
  it('rolls the reviewer notices back when the prepare fails after writing them', async () => {
    const f = await fixture();
    // Fails the audit write that follows the notices inside the same prepare transaction.
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION mcp_test_fail_prepare_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable'; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER mcp_test_fail_prepare_audit BEFORE INSERT ON "AuditLog"
      FOR EACH ROW WHEN (NEW.action = 'mcp.operation.prepared')
      EXECUTE FUNCTION mcp_test_fail_prepare_audit()`);
    try {
      const before = await db.inAppNotification.count();
      await expect(
        prepareMcpOperation(f.ctx(), f.announcementArgs('Rolled back'))
      ).rejects.toThrow();
      expect(await db.inAppNotification.count()).toBe(before);
      expect(await db.mcpOperationApproval.count({ where: { actorId: f.user.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS mcp_test_fail_prepare_audit ON "AuditLog"'
      );
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS mcp_test_fail_prepare_audit()');
    }
    // The same request goes through, with its notice, once the failure is gone.
    const prepared = await prepareMcpOperation(f.ctx(), f.announcementArgs('Rolled back'));
    expect(await notificationsFor(prepared.approvalId)).toHaveLength(1);
  });

  it('queues no email or other outbound delivery for requests or decisions', async () => {
    // Owner decision: email would reach every administrator, so approvals are in-app only.
    const f = await fixture();
    await createTestUser({ role: 'ADMIN' });
    const outbound = () => db.notification.count();
    const before = await outbound();
    const change = await prepareMcpOperation(f.ctx(), f.announcementArgs('No email'));
    await f.review(change, 'approve');
    const rejected = await prepareMcpOperation(f.ctx(), f.announcementArgs('No email either'));
    await f.review(rejected, 'reject');
    const r = await runbookFixture();
    const plan = await r.prepare();
    await decideMcpRunbookReview(
      { id: plan.previewId, planDigest: plan.planDigest, decision: 'reject', reason: 'No' },
      r.reviewer
    );
    expect(await outbound()).toBe(before);
    // The in-app notices were written: reviewers for each request, requesters for each decision.
    expect(
      await db.inAppNotification.count({
        where: { entityId: { in: [change.approvalId, rejected.approvalId, plan.previewId] } },
      })
    ).toBeGreaterThanOrEqual(5);
  });
});

describe('C2 review and commit windows come from the policy', () => {
  it('waits the policy TTL for review, and approval opens a fresh commit window', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    near(prepared.expiresAt, Date.now() + minutes(240));
    expect(prepared.commitWindowMinutes).toBe(30);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { approvalTtlMinutes: 60 } });
    const shorter = await prepareMcpOperation(f.ctx(), f.announcementArgs('Shorter'));
    near(shorter.expiresAt, Date.now() + minutes(60));
  });

  it('still commits a change approved seconds before its review deadline', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    // Approved at "minute 14:40" of what used to be a hard 15-minute window.
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { expiresAt: new Date(Date.now() + 1500) },
    });
    await f.review(prepared);
    const row = await db.mcpOperationApproval.findUniqueOrThrow({
      where: { id: prepared.approvalId },
    });
    near(row.commitDeadline, Date.now() + minutes(30));
    expect(row.expiresAt.getTime()).toBe(row.commitDeadline!.getTime());
    await new Promise(resolve => setTimeout(resolve, 2000));
    const state = await getMcpOperationApproval(f.ctx(), { approvalId: prepared.approvalId });
    expect(state).toMatchObject({ status: 'APPROVED', next: 'operation_commit_approved' });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).resolves.toMatchObject({ status: 'COMMITTED' });
  });

  it('caps the commit deadline at 24 hours after the request', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    const createdAt = new Date(Date.now() - minutes(24 * 60 - 10));
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { createdAt },
    });
    await f.review(prepared);
    const row = await db.mcpOperationApproval.findUniqueOrThrow({
      where: { id: prepared.approvalId },
    });
    near(row.commitDeadline, createdAt.getTime() + minutes(24 * 60), 1000);
  });

  it('gives runbook plans the same review and commit windows', async () => {
    const f = await runbookFixture();
    const prepared = await f.prepare();
    near(prepared.expiresAt, Date.now() + minutes(240));
    near(
      (
        await db.runbookPreviewAuthorization.findUniqueOrThrow({
          where: { id: prepared.previewId },
        })
      ).expiresAt,
      Date.now() + minutes(240)
    );
    // The native preview lifetime is five minutes; a remote review must not be cut short by it.
    await db.runbookPreviewAuthorization.update({
      where: { id: prepared.previewId },
      data: { expiresAt: new Date(Date.now() + 1500) },
    });
    await decideMcpRunbookReview(
      { id: prepared.previewId, planDigest: prepared.planDigest, decision: 'approve' },
      f.reviewer
    );
    const row = await db.runbookPreviewAuthorization.findUniqueOrThrow({
      where: { id: prepared.previewId },
    });
    near(row.commitDeadline, Date.now() + minutes(30));
    await new Promise(resolve => setTimeout(resolve, 2000));
    const execution = await executeApprovedMcpRunbook(f.ctx(), {
      previewId: prepared.previewId,
      idempotencyKey: 'execute-late',
    });
    expect(execution.executionId).toBeTruthy();
  });
});

describe('C3 status and rejection reasons', () => {
  it('reports runbook plan status to the requesting grant only', async () => {
    const f = await runbookFixture();
    const prepared = await f.prepare();
    const status = () => getMcpRunbookApproval(f.ctx(), { previewId: prepared.previewId });
    expect(await status()).toMatchObject({
      status: 'PENDING',
      pollAfterSeconds: 30,
      poll: { afterSeconds: 30, stopAt: prepared.expiresAt },
      reviewUrl: `http://localhost:3000/settings/integrations/mcp/approvals/${prepared.previewId}`,
    });
    const other = await runbookFixture();
    expect(
      await codeOf(getMcpRunbookApproval(other.ctx(), { previewId: prepared.previewId }))
    ).toMatchObject({ code: 'MCP_APPROVAL_UNAVAILABLE' });
    await decideMcpRunbookReview(
      {
        id: prepared.previewId,
        planDigest: prepared.planDigest,
        decision: 'reject',
        reason: 'Use the staging gateway first',
      },
      f.reviewer
    );
    expect(await status()).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Use the staging gateway first',
      decisionReasonNotice: expect.stringContaining('untrusted'),
      hint: expect.stringContaining('new idempotencyKey'),
    });
    expect(
      await codeOf(
        executeApprovedMcpRunbook(f.ctx(), { previewId: prepared.previewId, idempotencyKey: 'x' })
      )
    ).toMatchObject({ code: 'MCP_APPROVAL_REJECTED' });
  });

  it('reports approved and consumed plans', async () => {
    const f = await runbookFixture();
    const prepared = await f.prepare();
    await decideMcpRunbookReview(
      { id: prepared.previewId, planDigest: prepared.planDigest, decision: 'approve' },
      f.reviewer
    );
    expect(await getMcpRunbookApproval(f.ctx(), { previewId: prepared.previewId })).toMatchObject({
      status: 'APPROVED',
      next: 'runbook_execute_approved',
    });
    await executeApprovedMcpRunbook(f.ctx(), {
      previewId: prepared.previewId,
      idempotencyKey: 'execute',
    });
    expect(await getMcpRunbookApproval(f.ctx(), { previewId: prepared.previewId })).toMatchObject({
      status: 'CONSUMED',
    });
  });

  it('records who rejected a change and why, and shows the reason as untrusted text', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await f.review(prepared, 'reject');
    const row = await db.mcpOperationApproval.findUniqueOrThrow({
      where: { id: prepared.approvalId },
    });
    expect(row).toMatchObject({
      status: 'REJECTED',
      rejectedById: f.reviewer.id,
      reviewedById: null,
    });

    const second = await prepareMcpOperation(f.ctx(), f.announcementArgs('With reason'));
    const { decideMcpOperationReview } = await import('@/lib/mcp/approvals/operation');
    await expect(
      decideMcpOperationReview(
        {
          id: second.approvalId,
          operationDigest: second.operationDigest,
          decision: 'reject',
          reason: 'x'.repeat(501),
        },
        f.reviewer
      )
    ).rejects.toThrow();
    await decideMcpOperationReview(
      {
        id: second.approvalId,
        operationDigest: second.operationDigest,
        decision: 'reject',
        reason: 'Wrong page; post it on the public one',
      },
      f.reviewer
    );
    expect(await getMcpOperationApproval(f.ctx(), { approvalId: second.approvalId })).toMatchObject(
      {
        status: 'REJECTED',
        decisionReason: 'Wrong page; post it on the public one',
        decisionReasonNotice: expect.stringContaining('untrusted'),
      }
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: second.approvalId, action: 'mcp.operation.rejected' },
    });
    expect(audit.details).toMatchObject({
      metadata: { reason: 'Wrong page; post it on the public one' },
    });
  });

  it('shows a requester their own request and nobody else', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    expect((await loadMcpOperationRequest(prepared.approvalId, f.user.id))?.id).toBe(
      prepared.approvalId
    );
    expect(await loadMcpOperationRequest(prepared.approvalId, f.reviewer.id)).toBeNull();
    const r = await runbookFixture();
    const plan = await r.prepare();
    expect((await loadMcpRunbookRequest(plan.previewId, r.user.id))?.id).toBe(plan.previewId);
    expect(await loadMcpRunbookRequest(plan.previewId, r.reviewer.id)).toBeNull();
  });
});

describe('C4 expiry and clean-up', () => {
  it('refuses to replay a prepare whose approval lapsed or was rejected', async () => {
    const f = await fixture();
    const input = await f.leadArgs();
    const prepared = await prepareMcpOperation(f.ctx(), input);
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await codeOf(prepareMcpOperation(f.ctx(), input));
    expect(expired).toMatchObject({ code: 'MCP_APPROVAL_EXPIRED' });
    expect(expired.hint).toContain('new idempotencyKey');

    const other = f.announcementArgs('Reject me');
    const second = await prepareMcpOperation(f.ctx(), other);
    await f.review(second, 'reject');
    expect(await codeOf(prepareMcpOperation(f.ctx(), other))).toMatchObject({
      code: 'MCP_APPROVAL_REJECTED',
    });

    const r = await runbookFixture();
    const plan = await r.prepare();
    await db.runbookPreviewAuthorization.update({
      where: { id: plan.previewId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await codeOf(r.prepare())).toMatchObject({ code: 'MCP_APPROVAL_EXPIRED' });
  });

  it('marks lapsed approvals EXPIRED, drops their envelope and audits each once', async () => {
    // Close out anything earlier tests left lapsed, so the counts below are this test's own.
    await expireMcpApprovals();
    const f = await fixture();
    const lapsedPending = await prepareMcpOperation(f.ctx(), f.announcementArgs('A'));
    const lapsedApproved = await prepareMcpOperation(f.ctx(), f.announcementArgs('B'));
    await f.review(lapsedApproved);
    const open = await prepareMcpOperation(f.ctx(), f.announcementArgs('C'));
    await db.mcpOperationApproval.updateMany({
      where: { id: { in: [lapsedPending.approvalId, lapsedApproved.approvalId] } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await runbookFixture();
    const plan = await r.prepare();
    await db.runbookPreviewAuthorization.update({
      where: { id: plan.previewId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const swept = await expireMcpApprovals();
    expect(swept).toEqual({ operations: 2, runbooks: 1 });
    for (const id of [lapsedPending.approvalId, lapsedApproved.approvalId]) {
      const row = await db.mcpOperationApproval.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'EXPIRED', envelope: null });
      expect(
        await db.auditLog.count({ where: { entityId: id, action: 'mcp.operation.expired' } })
      ).toBe(1);
    }
    expect(
      (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: open.approvalId } })).status
    ).toBe('PENDING');
    expect(
      (await db.runbookPreviewAuthorization.findUniqueOrThrow({ where: { id: plan.previewId } }))
        .requestEnvelope
    ).toBeNull();
    // Persisted EXPIRED reads and commits as expired, with the re-prepare hint.
    expect(
      await getMcpOperationApproval(f.ctx(), { approvalId: lapsedApproved.approvalId })
    ).toMatchObject({ status: 'EXPIRED', hint: expect.stringContaining('new idempotencyKey') });
    expect(
      await codeOf(commitApprovedMcpOperation(f.ctx(), { approvalId: lapsedApproved.approvalId }))
    ).toMatchObject({ code: 'MCP_APPROVAL_EXPIRED' });

    expect(await expireMcpApprovals()).toEqual({ operations: 0, runbooks: 0 });
    expect(
      await db.auditLog.count({
        where: { entityId: lapsedPending.approvalId, action: 'mcp.operation.expired' },
      })
    ).toBe(1);
  });

  it('prunes spent tokens and authorization codes after the replay window', async () => {
    const f = await fixture();
    const day = 86_400_000;
    const token = (rotatedAt: Date | null, refreshExpiresAt: Date) =>
      db.mcpToken.create({
        data: {
          grantId: f.grant.id,
          scopes: [],
          accessHash: digestMcpSecret(randomBytes(32).toString('hex')),
          refreshHash: digestMcpSecret(randomBytes(32).toString('hex')),
          accessExpiresAt: new Date(Date.now() - day),
          refreshExpiresAt,
          rotatedAt,
        },
      });
    const oldRotated = await token(new Date(Date.now() - 8 * day), new Date(Date.now() + day));
    const oldExpired = await token(null, new Date(Date.now() - 8 * day));
    const recentRotated = await token(new Date(Date.now() - day), new Date(Date.now() + day));
    const code = (expiresAt: Date) =>
      db.mcpAuthorizationCode.create({
        data: {
          hash: randomBytes(16).toString('hex'),
          grantId: f.grant.id,
          redirectUri: 'http://localhost/callback',
          challenge: 'c'.repeat(43),
          expiresAt,
        },
      });
    const oldCode = await code(new Date(Date.now() - 8 * day));
    const recentCode = await code(new Date(Date.now() - day));
    const result = await cleanupMcpCredentials();
    expect(result.tokens).toBeGreaterThanOrEqual(2);
    expect(result.codes).toBeGreaterThanOrEqual(1);
    const left = new Set(
      (await db.mcpToken.findMany({ where: { grantId: f.grant.id }, select: { id: true } })).map(
        row => row.id
      )
    );
    expect(left.has(oldRotated.id)).toBe(false);
    expect(left.has(oldExpired.id)).toBe(false);
    expect(left.has(recentRotated.id)).toBe(true);
    expect(left.has(f.token.id)).toBe(true);
    expect(await db.mcpAuthorizationCode.findUnique({ where: { hash: oldCode.hash } })).toBeNull();
    expect(
      await db.mcpAuthorizationCode.findUnique({ where: { hash: recentCode.hash } })
    ).not.toBeNull();
  });
});
