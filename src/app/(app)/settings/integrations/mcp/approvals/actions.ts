'use server';

import { z } from 'zod/v3';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { requireMcp } from '@/lib/mcp/core/errors';
import { decideMcpRunbookReview } from '@/lib/mcp/approvals/runbook';
import { decideMcpOperationReview } from '@/lib/mcp/approvals/operation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { expectedReviewCode, type ReviewResult } from './review-result';

const reason = (form: FormData) => {
  const value = form.get('reason');
  return typeof value === 'string' && value.trim() ? value : undefined;
};

/** Expected refusals become a typed result the form can explain; anything else still throws. */
async function decided(
  decision: 'approve' | 'reject',
  run: () => Promise<unknown>
): Promise<ReviewResult> {
  try {
    await run();
    return { ok: true, decision };
  } catch (error) {
    const code = expectedReviewCode(error);
    if (!code) throw error;
    return { ok: false, code };
  }
}

export async function reviewPreparedRunbook(
  _previous: ReviewResult | null,
  form: FormData
): Promise<ReviewResult> {
  const input = z
    .object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      planDigest: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['approve', 'reject']),
      confirmSelfApproval: z.literal('yes').optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .parse({
      id: form.get('id'),
      planDigest: form.get('planDigest'),
      decision: form.get('decision'),
      confirmSelfApproval: form.get('confirmSelfApproval') ?? undefined,
      reason: reason(form),
    });
  const result = await decided(input.decision, async () => {
    const permissions = await getUserPermissions();
    requireMcp(
      permissions.capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE),
      'MCP_APPROVER_REQUIRED',
      403
    );
    const user = await getCurrentUser();
    requireMcp(
      (await checkRateLimit(`mcp:review:${user.id}`, 10, 60000)).allowed,
      'MCP_RATE_LIMITED',
      429
    );
    await decideMcpRunbookReview(input, { id: user.id, tokenVersion: user.tokenVersion });
  });
  revalidatePath(`/settings/integrations/mcp/approvals/${input.id}`);
  return result;
}

export async function reviewPreparedOperation(
  _previous: ReviewResult | null,
  form: FormData
): Promise<ReviewResult> {
  const input = z
    .object({
      id: z.string().cuid(),
      operationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['approve', 'reject']),
      confirmSelfApproval: z.literal('yes').optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .parse({
      id: form.get('id'),
      operationDigest: form.get('operationDigest'),
      decision: form.get('decision'),
      confirmSelfApproval: form.get('confirmSelfApproval') ?? undefined,
      reason: reason(form),
    });
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const result = await decided(input.decision, async () => {
    const user = await getCurrentUser();
    requireMcp(
      (await checkRateLimit(`mcp:review:${user.id}`, 10, 60000)).allowed,
      'MCP_RATE_LIMITED',
      429
    );
    // The command rechecks that this user may review (a different person, or a confirming
    // administrator). Destructive approvals also need a recent sign-in, taken from the session,
    // never the form.
    const session = await getServerSession(await getAuthOptions());
    await decideMcpOperationReview(input, {
      id: user.id,
      tokenVersion: user.tokenVersion,
      authenticatedAt: session?.user?.id === user.id ? session.authenticatedAt : undefined,
    });
  });
  revalidatePath(`/settings/integrations/mcp/approvals/operations/${input.id}`);
  return result;
}
