import 'server-only';
import type { Prisma } from '@prisma/client';
import { requireMcp } from '../core/errors';

/**
 * Strict four-eyes for MCP approvals. By default an administrator may approve a change their own
 * assistant prepared, after an explicit confirmation. When an administrator turns on "Require a
 * different reviewer" nobody may approve their own request: it needs a second person, whatever
 * the role. Read inside the review transaction, so a policy change applies to the very next
 * decision, including ones already open in a browser.
 */
export async function enforceDistinctReviewer(tx: Prisma.TransactionClient, selfReview: boolean) {
  if (!selfReview) return;
  const policy = await tx.mcpPolicy.findUnique({
    where: { id: 'default' },
    select: { requireDistinctReviewer: true },
  });
  requireMcp(!policy?.requireDistinctReviewer, 'MCP_DISTINCT_REVIEWER_REQUIRED', 403);
}
