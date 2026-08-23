'use server';

import { createHash, randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export type OidcLinkingApprovalResult = {
  success?: boolean;
  alreadyLinked?: boolean;
  error?: string;
};

/**
 * Explicitly authorizes first-time OIDC linking for an existing user without
 * changing the account status or issuing a usable invitation credential.
 *
 * The auth flow introduced in #336 treats an INVITE record as durable
 * administrator-provisioning evidence. For existing ACTIVE users that predate
 * that flow, this action records equivalent evidence as an already-used,
 * immediately-expired marker. It cannot be redeemed as an invite link.
 */
export async function allowOidcLinking(userId: string): Promise<OidcLinkingApprovalResult> {
  let admin: { id: string; email: string };
  try {
    admin = await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true },
  });

  if (!user) return { error: 'User not found.' };
  if (user.status === 'DISABLED') {
    return { error: 'Reactivate the user before allowing OIDC linking.' };
  }

  const existingIdentity = await prisma.oidcIdentity.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (existingIdentity) {
    return { success: true, alreadyLinked: true };
  }

  const identifier = user.email.toLowerCase();
  const existingProvisioningEvidence = await prisma.userToken.findFirst({
    where: { identifier, type: 'INVITE' },
    select: { id: true },
  });

  if (!existingProvisioningEvidence) {
    const now = new Date();
    const marker = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(marker).digest('hex');

    await prisma.userToken.create({
      data: {
        identifier,
        type: 'INVITE',
        tokenHash,
        expiresAt: now,
        usedAt: now,
      },
    });
  }

  await logAudit({
    action: 'user.oidc_linking.approved',
    entityType: 'USER',
    entityId: user.id,
    actorId: admin.id,
    details: { email: identifier },
  });

  logger.info('[Auth] Admin approved first-time OIDC linking', {
    component: 'users-actions',
    userId: user.id,
    email: identifier,
    adminId: admin.id,
  });

  revalidatePath('/users');
  revalidatePath('/audit');
  return { success: true };
}
