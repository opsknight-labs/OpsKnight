import 'server-only';

import type { Prisma, Role } from '@prisma/client';
import { AppError } from '@/lib/errors';

/**
 * Separation of duties (four-eyes): the person who asked for something should not approve it.
 *
 * Self-approval is refused while another active person could approve instead. If nobody else
 * is eligible (for example a single-administrator organization) it stays possible, so work is
 * never blocked, and callers record it as self-approved in the audit log. Organizations can
 * explicitly allow self-approval in Access management.
 */
export async function assertSeparationOfDuties(
  tx: Prisma.TransactionClient,
  input: {
    requesterId: string | null | undefined;
    approverId: string;
    /** Built-in roles that may approve this kind of request. */
    eligibleRoles: readonly Role[];
    what: string;
  }
): Promise<{ selfApproved: boolean }> {
  if (!input.requesterId || input.requesterId !== input.approverId) return { selfApproved: false };
  const settings = await tx.systemSettings.findUnique({
    where: { id: 'default' },
    select: { accessSelfApprovalAllowed: true },
  });
  if (settings?.accessSelfApprovalAllowed) return { selfApproved: true };
  const otherApprover = await tx.user.findFirst({
    where: {
      id: { not: input.approverId },
      status: 'ACTIVE',
      role: { in: [...input.eligibleRoles] },
    },
    select: { id: true },
  });
  if (!otherApprover) return { selfApproved: true };
  throw new AppError({
    code: 'SEPARATION_OF_DUTIES',
    userMessage: `You started this ${input.what}, so someone else must approve it.`,
    details: { requesterId: input.requesterId },
  });
}
