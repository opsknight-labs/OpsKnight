import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';
import { approvedLead, connect, fixture, type Fixture } from '../helpers/mcp-approval';
import { encrypt } from '@/lib/encryption';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import type { ExecutionContext } from '@/lib/mcp/core/execution';
import {
  commitApprovedMcpOperation,
  mcpApprovalCommitKey,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';

/**
 * Fault injection: the budget is consulted at every phase boundary (before/inside each
 * transaction, and again after the domain effect committed). Failing at the k-th consultation
 * models a crash or lost response at that exact point, so sweeping k visits every boundary.
 */
class FailingBudget extends CostBudget {
  consultations = 0;
  constructor(private readonly failAt: number) {
    super();
  }
  private tick() {
    if (++this.consultations === this.failAt)
      throw new McpBoundaryError('MCP_INJECTED_FAILURE', 503);
  }
  override check() {
    this.tick();
    super.check();
  }
  override consumeResult(value: unknown) {
    this.tick();
    super.consumeResult(value);
  }
}
const withBudget = (f: Fixture, budget: CostBudget): ExecutionContext => ({ ...f.ctx(), budget });

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
    create: { enabled: true, writesEnabled: true, requestsPerMinute: 6000 },
    update: { enabled: true, writesEnabled: true, requestsPerMinute: 6000 },
  });
});

const announcements = (f: Fixture) =>
  db.statusPageAnnouncement.count({ where: { statusPageId: f.page.id } });
const approvalState = (id: string) =>
  db.mcpOperationApproval.findUniqueOrThrow({ where: { id }, select: { status: true } });
async function commitUntilSettled(f: Fixture, approvalId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await commitApprovedMcpOperation(f.ctx(), { approvalId });
    } catch {
      // A retry is the documented recovery path after any failed or lost response.
    }
  }
  throw new Error('approval did not settle after retries');
}

describe('approval commit crash and replay safety', () => {
  it('applies a revision-bound change exactly once however the commit is interrupted', async () => {
    // Baseline: how many boundaries a healthy commit crosses and how far the revision moves.
    const baseline = await fixture();
    const baselinePrepared = await approvedLead(baseline);
    const before = await baseline.teamRevision();
    const counter = new FailingBudget(0);
    await commitApprovedMcpOperation(withBudget(baseline, counter), {
      approvalId: baselinePrepared.approvalId,
    });
    const delta = (await baseline.teamRevision()) - before;
    expect(delta).toBeGreaterThan(0);
    expect(counter.consultations).toBeGreaterThan(8);

    let crashedAfterEffect = 0;
    for (let failAt = 1; failAt <= counter.consultations + 1; failAt++) {
      const f = await fixture();
      const prepared = await approvedLead(f);
      const start = await f.teamRevision();
      try {
        await commitApprovedMcpOperation(withBudget(f, new FailingBudget(failAt)), {
          approvalId: prepared.approvalId,
        });
      } catch {
        // injected crash / lost response
      }
      const midRevision = await f.teamRevision();
      expect([start, start + delta], `failAt=${failAt}`).toContain(midRevision);
      if (midRevision === start + delta) crashedAfterEffect++;
      const settled = await commitUntilSettled(f, prepared.approvalId);
      expect(settled, `failAt=${failAt}`).toMatchObject({ status: 'COMMITTED' });
      expect(await f.teamRevision(), `failAt=${failAt}`).toBe(start + delta);
      expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
        teamLeadId: f.lead.id,
      });
      expect(await approvalState(prepared.approvalId)).toEqual({ status: 'COMMITTED' });
      // Further retries and lost responses are pure replays.
      await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
      expect(await f.teamRevision()).toBe(start + delta);
    }
    // The sweep must actually have exercised "effect committed, outcome not yet recorded".
    expect(crashedAfterEffect).toBeGreaterThan(0);
  });

  it('creates exactly one record for a create operation at every interruption point', async () => {
    const baseline = await fixture();
    const prepared = await prepareMcpOperation(baseline.ctx(), baseline.announcementArgs());
    await baseline.review(prepared);
    const counter = new FailingBudget(0);
    await commitApprovedMcpOperation(withBudget(baseline, counter), {
      approvalId: prepared.approvalId,
    });
    let crashedAfterEffect = 0;
    for (let failAt = 1; failAt <= counter.consultations + 1; failAt++) {
      const f = await fixture();
      const approval = await prepareMcpOperation(f.ctx(), f.announcementArgs());
      await f.review(approval);
      try {
        await commitApprovedMcpOperation(withBudget(f, new FailingBudget(failAt)), {
          approvalId: approval.approvalId,
        });
      } catch {
        // injected crash / lost response
      }
      const mid = await announcements(f);
      expect(mid, `failAt=${failAt}`).toBeLessThanOrEqual(1);
      if (mid === 1) crashedAfterEffect++;
      expect(await commitUntilSettled(f, approval.approvalId), `failAt=${failAt}`).toMatchObject({
        status: 'COMMITTED',
      });
      expect(await announcements(f), `failAt=${failAt}`).toBe(1);
      await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
      expect(await announcements(f)).toBe(1);
    }
    expect(crashedAfterEffect).toBeGreaterThan(0);
  });

  it('creates one approval for a prepare interrupted at every boundary and retried', async () => {
    const baseline = await fixture();
    const counter = new FailingBudget(0);
    await prepareMcpOperation(withBudget(baseline, counter), baseline.announcementArgs());
    for (let failAt = 1; failAt <= counter.consultations + 1; failAt++) {
      const f = await fixture();
      const input = f.announcementArgs();
      try {
        await prepareMcpOperation(withBudget(f, new FailingBudget(failAt)), input);
      } catch {
        // injected crash / lost response
      }
      const retried = await prepareMcpOperation(f.ctx(), input);
      expect(
        await db.mcpOperationApproval.count({ where: { requesterGrantId: f.grant.id } }),
        `failAt=${failAt}`
      ).toBe(1);
      expect(retried.status).toBe('REQUIRES_NATIVE_APPROVAL');
    }
  });

  it('applies one effect when many callers commit the same approval concurrently', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const start = await f.teamRevision();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
      )
    );
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    const settled = await commitUntilSettled(f, prepared.approvalId);
    expect(settled).toMatchObject({ status: 'COMMITTED' });
    const revision = await f.teamRevision();
    expect(revision).toBeGreaterThan(start);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(await f.teamRevision()).toBe(revision);
    expect(
      await db.auditLog.count({
        where: { entityId: prepared.approvalId, action: 'mcp.operation.committed' },
      })
    ).toBe(1);
  });

  it('lets exactly one decision win when reviewers race to approve or reject', async () => {
    const f = await fixture();
    const second = (await import('../helpers/test-db')).createTestUser;
    const otherReviewer = await second({ role: 'ADMIN' });
    for (const pair of [
      ['approve', 'approve'],
      ['approve', 'reject'],
      ['reject', 'approve'],
    ] as const) {
      const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
      const results = await Promise.allSettled([
        f.review(prepared, pair[0], f.reviewer),
        f.review(prepared, pair[1], otherReviewer),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const row = await db.mcpOperationApproval.findUniqueOrThrow({
        where: { id: prepared.approvalId },
      });
      expect(Boolean(row.reviewedAt) !== Boolean(row.rejectedAt)).toBe(true);
      expect(row.status).toBe(row.reviewedAt ? 'APPROVED' : 'REJECTED');
      expect(
        await db.auditLog.count({
          where: {
            entityId: prepared.approvalId,
            action: { in: ['mcp.operation.approved', 'mcp.operation.rejected'] },
          },
        })
      ).toBe(1);
    }
  });

  it('refuses a second connection of the same user and any other user', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const start = await f.teamRevision();
    const sibling = await connect(f.user.id, f.user.tokenVersion);
    const results = await Promise.allSettled([
      commitApprovedMcpOperation(sibling.ctx(), { approvalId: prepared.approvalId }),
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId }),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(await f.teamRevision()).toBeGreaterThan(start);
  });

  it('does not extend a claimed approval beyond its execution window', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const start = await f.teamRevision();
    // Claimed, but the crash happened before the effect; far too long ago to resume.
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { status: 'EXECUTING', executingAt: new Date(Date.now() - 2 * 3600_000) },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_EXPIRED');
    expect(await f.teamRevision()).toBe(start);
    // Within the window a claimed-but-unexecuted approval resumes and executes once.
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { executingAt: new Date() },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).resolves.toMatchObject({ status: 'COMMITTED' });
  });

  it('rejects a modified digest, envelope or reviewed contract', async () => {
    const digestTamper = await fixture();
    const first = await approvedLead(digestTamper);
    await db.mcpOperationApproval.update({
      where: { id: first.approvalId },
      data: { operationDigest: 'b'.repeat(64) },
    });
    await expect(
      commitApprovedMcpOperation(digestTamper.ctx(), { approvalId: first.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');

    const contractTamper = await fixture();
    const second = await approvedLead(contractTamper);
    await db.mcpOperationApproval.update({
      where: { id: second.approvalId },
      data: { contractDigest: 'c'.repeat(64) },
    });
    await expect(
      commitApprovedMcpOperation(contractTamper.ctx(), { approvalId: second.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');

    const envelopeTamper = await fixture();
    const third = await approvedLead(envelopeTamper);
    await db.mcpOperationApproval.update({
      where: { id: third.approvalId },
      data: {
        envelope: await encrypt(
          JSON.stringify({ path: { id: envelopeTamper.team.id }, body: { userId: null } })
        ),
      },
    });
    await expect(
      commitApprovedMcpOperation(envelopeTamper.ctx(), { approvalId: third.approvalId })
    ).rejects.toThrow();
    for (const f of [digestTamper, contractTamper, envelopeTamper])
      expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
        teamLeadId: null,
      });
  });

  it('keeps a committed effect committed even if a definitive rejection is later recorded', async () => {
    const f = await fixture();
    const input = f.announcementArgs();
    const prepared = await prepareMcpOperation(f.ctx(), input);
    await f.review(prepared);
    // Effect commits, then the response is lost before the approval is finalized.
    const probe = new FailingBudget(0);
    await commitApprovedMcpOperation(withBudget(f, probe), { approvalId: prepared.approvalId });
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: {
        status: 'EXECUTING',
        committedAt: null,
        outcome: undefined,
        envelope: await encrypt(JSON.stringify({ path: input.args.path, body: input.args.body })),
      },
    });
    const receipt = await db.backgroundJob.count({
      where: {
        id: {
          startsWith: 'idem:',
          endsWith: `:mcp:${f.grant.id}:${mcpApprovalCommitKey(prepared.approvalId)}`,
        },
      },
    });
    expect(receipt).toBe(1);
    expect(await commitUntilSettled(f, prepared.approvalId)).toMatchObject({ status: 'COMMITTED' });
    expect(await announcements(f)).toBe(1);
  });

  it('refuses an expired or revoked approval at every stage without any effect', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const start = await f.teamRevision();
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    for (let attempt = 0; attempt < 3; attempt++)
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
      ).rejects.toThrow('MCP_APPROVAL_EXPIRED');
    expect(await f.teamRevision()).toBe(start);

    const revoked = await fixture();
    const second = await approvedLead(revoked);
    const startRevoked = await revoked.teamRevision();
    await db.mcpToken.update({
      where: { id: revoked.token.id },
      data: { rotatedAt: new Date() },
    });
    await expect(
      commitApprovedMcpOperation(revoked.ctx(), { approvalId: second.approvalId })
    ).rejects.toThrow();
    expect(await revoked.teamRevision()).toBe(startRevoked);
  });
});
