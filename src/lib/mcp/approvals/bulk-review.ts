import prisma from '@/lib/prisma';
import { decideMcpOperationReview } from './operation';

export type BulkReviewResult = {
  decision: 'approve' | 'reject';
  done: number;
  /** Requests left untouched, with the refusal code shown to the reviewer. */
  skipped: { id: string; code: string }[];
};

/**
 * Decides several pending configuration changes. Every request goes through the same command as
 * a single review, so each check (reviewer, expiry, distinct reviewer, recent sign-in) still runs
 * per request and a refusal skips only that request. Approving in bulk is limited to the medium
 * risk class: a high-risk change must be opened and read. A request the reviewer made themselves
 * is never approved here, because that needs an explicit confirmation on its own page.
 */
export async function decideMcpOperationReviewsInBulk(
  ids: readonly string[],
  decision: 'approve' | 'reject',
  reviewer: { id: string; tokenVersion: number; authenticatedAt?: number }
): Promise<BulkReviewResult> {
  const approvals = await prisma.mcpOperationApproval.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, operationDigest: true, riskClass: true },
  });
  const result: BulkReviewResult = { decision, done: 0, skipped: [] };
  for (const id of ids) {
    const approval = approvals.find(row => row.id === id);
    if (!approval) result.skipped.push({ id, code: 'MCP_APPROVAL_UNAVAILABLE' });
    else if (decision === 'approve' && approval.riskClass !== 'R2')
      result.skipped.push({ id, code: 'MCP_BULK_APPROVE_RISK' });
    else
      try {
        await decideMcpOperationReview(
          { id, operationDigest: approval.operationDigest, decision },
          reviewer
        );
        result.done++;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : null;
        if (!code) throw error;
        result.skipped.push({ id, code });
      }
  }
  return result;
}
