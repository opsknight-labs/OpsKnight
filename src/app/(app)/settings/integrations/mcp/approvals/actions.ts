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

export async function reviewPreparedRunbook(form: FormData) {
  const input = z
    .object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      planDigest: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['approve', 'reject']),
      confirmSelfApproval: z.literal('yes').optional(),
    })
    .strict()
    .parse({
      id: form.get('id'),
      planDigest: form.get('planDigest'),
      decision: form.get('decision'),
      confirmSelfApproval: form.get('confirmSelfApproval') ?? undefined,
    });
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
  revalidatePath(`/settings/integrations/mcp/approvals/${input.id}`);
}

export async function reviewPreparedOperation(form: FormData) {
  const input = z
    .object({
      id: z.string().cuid(),
      operationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['approve', 'reject']),
      confirmSelfApproval: z.literal('yes').optional(),
    })
    .strict()
    .parse({
      id: form.get('id'),
      operationDigest: form.get('operationDigest'),
      decision: form.get('decision'),
      confirmSelfApproval: form.get('confirmSelfApproval') ?? undefined,
    });
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const user = await getCurrentUser();
  requireMcp(
    (await checkRateLimit(`mcp:review:${user.id}`, 10, 60000)).allowed,
    'MCP_RATE_LIMITED',
    429
  );
  // The command rechecks that this user may review (a different person, or a confirming administrator).
  // Destructive approvals also need a recent sign-in, taken from the session, never the form.
  const session = await getServerSession(await getAuthOptions());
  await decideMcpOperationReview(input, {
    id: user.id,
    tokenVersion: user.tokenVersion,
    authenticatedAt: session?.user?.id === user.id ? session.authenticatedAt : undefined,
  });
  revalidatePath(`/settings/integrations/mcp/approvals/operations/${input.id}`);
}
