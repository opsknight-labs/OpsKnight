// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';
import {
  commitApprovedMcpOperation,
  decideMcpOperationReview,
  loadMcpOperationReview,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';
import { fixture } from '../helpers/mcp-approval';

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
  const policy = {
    enabled: true,
    writesEnabled: true,
    requestsPerMinute: 600,
    requireDistinctReviewer: false,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

const strict = (on: boolean) =>
  db.mcpPolicy.update({ where: { id: 'default' }, data: { requireDistinctReviewer: on } });

describe('strict four-eyes ("Require a different reviewer")', () => {
  it('is off by default: an administrator can still approve their own change after confirming', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    const self = {
      id: f.user.id,
      tokenVersion: f.user.tokenVersion,
      authenticatedAt: Date.now() - 60_000,
    };
    await decideMcpOperationReview(
      {
        id: prepared.approvalId,
        operationDigest: prepared.operationDigest,
        decision: 'approve',
        confirmSelfApproval: 'yes',
      },
      self
    );
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).resolves.toMatchObject({ status: 'COMMITTED' });
  });

  it('when on, the requester cannot view-to-decide, approve or reject their own request', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await strict(true);
    const self = {
      id: f.user.id,
      tokenVersion: f.user.tokenVersion,
      authenticatedAt: Date.now() - 60_000,
    };
    await expect(loadMcpOperationReview(prepared.approvalId, self)).rejects.toThrow(
      'MCP_DISTINCT_REVIEWER_REQUIRED'
    );
    for (const decision of ['approve', 'reject'] as const)
      await expect(
        decideMcpOperationReview(
          {
            id: prepared.approvalId,
            operationDigest: prepared.operationDigest,
            decision,
            // Confirmation does not help: this is a hard rule, not a warning.
            confirmSelfApproval: 'yes',
          },
          self
        )
      ).rejects.toThrow('MCP_DISTINCT_REVIEWER_REQUIRED');
    expect(
      (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: prepared.approvalId } }))
        .status
    ).toBe('PENDING');
    expect(
      await db.team.findUnique({ where: { id: f.team.id }, select: { teamLeadId: true } })
    ).toMatchObject({ teamLeadId: null });
  });

  it('when on, a second administrator can approve and the change commits', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await strict(true);
    await f.review(prepared);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).resolves.toMatchObject({ status: 'COMMITTED' });
    expect(
      await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: prepared.approvalId } })
    ).toMatchObject({ selfApproved: false });
  });

  it('applies to a request that was already waiting, and lifting it applies to the next decision', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    const self = {
      id: f.user.id,
      tokenVersion: f.user.tokenVersion,
      authenticatedAt: Date.now() - 60_000,
    };
    const decide = () =>
      decideMcpOperationReview(
        {
          id: prepared.approvalId,
          operationDigest: prepared.operationDigest,
          decision: 'approve',
          confirmSelfApproval: 'yes',
        },
        self
      );
    // Prepared while off, then the administrator turns strict review on.
    await strict(true);
    await expect(decide()).rejects.toThrow('MCP_DISTINCT_REVIEWER_REQUIRED');
    await strict(false);
    await decide();
    expect(
      await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: prepared.approvalId } })
    ).toMatchObject({ status: 'APPROVED', selfApproved: true });
  });
});
