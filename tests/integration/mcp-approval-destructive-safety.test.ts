import { describe, expect, it } from 'vitest';
import { createTestTeam, testPrisma as db } from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import { setupMcpApprovalDatabase } from '../helpers/mcp-approval-scenarios';
import {
  commitApprovedMcpOperation,
  decideMcpOperationReview,
  loadMcpOperationReview,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';
import { operationReviewSchema } from '@/lib/mcp/catalog/review-schema';
import { encrypt } from '@/lib/encryption';
import { MCP_CATALOG } from '@/lib/mcp/catalog';

setupMcpApprovalDatabase();

const TWO_HOURS = 2 * 3600_000;
let key = 0;
async function prepareTeamDeletion(f: Awaited<ReturnType<typeof fixture>>, teamId: string) {
  return prepareMcpOperation(f.ctx(), {
    operationId: 'deleteTeam',
    args: { path: { id: teamId } },
    idempotencyKey: `prepare-destructive-${++key}-${Date.now()}`,
  });
}
const teamExists = async (id: string) => (await db.team.count({ where: { id } })) === 1;
const approvalRow = (id: string) => db.mcpOperationApproval.findUniqueOrThrow({ where: { id } });

describe('destructive (R3) approval safeguards', () => {
  it('requires a recent reviewer sign-in and records it', async () => {
    const f = await fixture();
    const team = await createTestTeam('Step-up');
    const prepared = await prepareTeamDeletion(f, team.id);
    // No sign-in time at all (the session did not carry one).
    await expect(
      decideMcpOperationReview(
        { id: prepared.approvalId, operationDigest: prepared.operationDigest, decision: 'approve' },
        { id: f.reviewer.id, tokenVersion: f.reviewer.tokenVersion }
      )
    ).rejects.toThrow('MCP_REAUTHENTICATION_REQUIRED');
    await expect(
      f.review(prepared, 'approve', f.reviewer, Date.now() - TWO_HOURS - 60_000)
    ).rejects.toThrow('MCP_REAUTHENTICATION_REQUIRED');
    // A future timestamp is not a way around the window.
    await expect(
      f.review(prepared, 'approve', f.reviewer, Date.now() + 10 * 60_000)
    ).rejects.toThrow('MCP_REAUTHENTICATION_REQUIRED');
    // Rejecting never needs a step-up.
    const other = await prepareTeamDeletion(f, (await createTestTeam('Reject only')).id);
    await decideMcpOperationReview(
      { id: other.approvalId, operationDigest: other.operationDigest, decision: 'reject' },
      { id: f.reviewer.id, tokenVersion: f.reviewer.tokenVersion }
    );
    const signedIn = Date.now() - 5 * 60_000;
    await f.review(prepared, 'approve', f.reviewer, signedIn);
    expect((await approvalRow(prepared.approvalId)).reviewerAuthenticatedAt?.getTime()).toBe(
      signedIn
    );
    // The database refuses an approved destructive row without that evidence.
    await expect(
      db.mcpOperationApproval.update({
        where: { id: prepared.approvalId },
        data: { reviewerAuthenticatedAt: null },
      })
    ).rejects.toThrow();
  });

  it('shows the target state to the native reviewer only', async () => {
    const f = await fixture();
    const team = await createTestTeam('Visible only to reviewer');
    const prepared = await prepareTeamDeletion(f, team.id);
    expect(prepared.summary.preview).toBe('[shown to reviewer]');
    expect(JSON.stringify(prepared)).not.toContain(team.name);
    const review = await loadMcpOperationReview(prepared.approvalId, f.reviewer);
    expect(review.requiresFreshAuthentication).toBe(true);
    expect(review.summary.preview).toContain(team.name);
    expect((await approvalRow(prepared.approvalId)).previewDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses to prepare against a target the requester cannot read', async () => {
    const f = await fixture();
    await expect(prepareTeamDeletion(f, 'cmcpdoesnotexist000000001')).rejects.toThrow(
      'MCP_RESOURCE_UNAVAILABLE'
    );
  });

  it('refuses a fresh commit when the target changed after review', async () => {
    const f = await fixture();
    const team = await createTestTeam('Will change');
    const prepared = await prepareTeamDeletion(f, team.id);
    await f.review(prepared);
    await db.team.update({ where: { id: team.id }, data: { description: 'edited after review' } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');
    expect(await teamExists(team.id)).toBe(true);
    expect(await approvalRow(prepared.approvalId)).toMatchObject({ status: 'FAILED' });
  });

  it('verifies and records the postcondition', async () => {
    const f = await fixture();
    const team = await createTestTeam('Delete me');
    const prepared = await prepareTeamDeletion(f, team.id);
    await f.review(prepared);
    const result = await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(result).toMatchObject({ status: 'COMMITTED' });
    expect(await teamExists(team.id)).toBe(false);
    expect((await approvalRow(prepared.approvalId)).outcome).toMatchObject({
      ok: true,
      postcondition: 'VERIFIED',
    });
  });

  it('reconciles an interrupted natural delete by observing the absent target', async () => {
    const f = await fixture();
    const team = await createTestTeam('Interrupted');
    const prepared = await prepareTeamDeletion(f, team.id);
    await f.review(prepared);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    // Simulate a crash after the deletion committed but before the approval was finalized.
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: {
        status: 'EXECUTING',
        committedAt: null,
        outcome: undefined,
        envelope: await encrypt(JSON.stringify({ path: { id: team.id } })),
      },
    });
    const recovered = await commitApprovedMcpOperation(f.ctx(), {
      approvalId: prepared.approvalId,
    });
    expect(recovered).toMatchObject({ status: 'COMMITTED' });
    expect((await approvalRow(prepared.approvalId)).outcome).toMatchObject({
      reconciled: true,
      postcondition: 'TARGET_ABSENT',
    });
  });

  it('does not treat a target that vanished before a fresh commit as success', async () => {
    const f = await fixture();
    const team = await createTestTeam('Gone first');
    const prepared = await prepareTeamDeletion(f, team.id);
    await f.review(prepared);
    await db.team.delete({ where: { id: team.id } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    expect(await approvalRow(prepared.approvalId)).toMatchObject({ status: 'FAILED' });
  });

  it('cannot gate a destructive operation without a preview, and gated ones declare one', () => {
    const target = MCP_CATALOG.find(op => op.operationId === 'deleteTeam')!;
    const base = {
      status: 'APPROVAL_REQUIRED',
      risk: 'R3',
      reason: target.reason,
      tool: null,
      routeSha256: target.routeSha256,
      contractSha256: target.contractSha256,
      resourceFilter: target.resourceFilter,
      evidence: target.evidence,
      actions: target.actions,
    };
    expect(operationReviewSchema.safeParse(base).success).toBe(false);
    expect(operationReviewSchema.safeParse({ ...base, impactPreview: 'getTeam' }).success).toBe(
      true
    );
    expect(
      operationReviewSchema.safeParse({ ...base, risk: 'R4', impactPreview: 'getTeam' }).success
    ).toBe(false);
    for (const operation of MCP_CATALOG.filter(
      op => op.status === 'APPROVAL_REQUIRED' && op.risk === 'R3'
    ))
      expect(operation.impactPreview, operation.operationId).toBeTruthy();
  });
});
