'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export type OidcLinkingState = 'not-approved' | 'approved' | 'linked';

export type OidcLinkingApprovalResult = {
  success?: boolean;
  alreadyLinked?: boolean;
  alreadyApproved?: boolean;
  state?: OidcLinkingState;
  error?: string;
};

async function getManagedUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true },
  });
}

async function readOidcLinkingState(userId: string, _email: string): Promise<OidcLinkingState> {
  const existingIdentity = await prisma.oidcIdentity.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (existingIdentity) return 'linked';

  const provisioningEvidence = await prisma.oidcLinkingApproval.findUnique({
    where: { userId },
    select: { id: true, revokedAt: true },
  });

  return provisioningEvidence && !provisioningEvidence.revokedAt ? 'approved' : 'not-approved';
}

export async function getOidcLinkingState(userId: string): Promise<OidcLinkingApprovalResult> {
  try {
    await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const user = await getManagedUser(userId);
  if (!user) return { error: 'User not found.' };

  const state = await readOidcLinkingState(user.id, user.email);
  return { success: true, state, alreadyLinked: state === 'linked' };
}

/**
 * Explicitly authorizes first-time OIDC linking for an existing ACTIVE user
 * without changing the account status or issuing a usable invitation link.
 */
export async function allowOidcLinking(userId: string): Promise<OidcLinkingApprovalResult> {
  let admin: { id: string; email: string };
  try {
    admin = await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const user = await getManagedUser(userId);
  if (!user) return { error: 'User not found.' };
  if (user.status !== 'ACTIVE') {
    return { error: 'OIDC linking approval can only be managed for active users.' };
  }

  const identifier = user.email.toLowerCase();
  const state = await readOidcLinkingState(user.id, identifier);
  if (state === 'linked') {
    return { success: true, alreadyLinked: true, state };
  }
  if (state === 'approved') {
    return { success: true, alreadyApproved: true, state };
  }

  await prisma.oidcLinkingApproval.upsert({
    where: { userId: user.id },
    create: { userId: user.id, approvedById: admin.id },
    update: {
      approvedById: admin.id,
      approvedAt: new Date(),
      revokedAt: null,
      generation: { increment: 1 },
    },
  });

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
  return { success: true, state: 'approved' };
}

/**
 * Revokes first-time OIDC linking eligibility for an ACTIVE user that has not
 * linked an OIDC identity yet. Existing credentials and account status are not
 * changed. A linked identity must be managed separately; this action never
 * silently unlinks an established identity.
 */
export async function revokeOidcLinking(userId: string): Promise<OidcLinkingApprovalResult> {
  let admin: { id: string; email: string };
  try {
    admin = await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const user = await getManagedUser(userId);
  if (!user) return { error: 'User not found.' };
  if (user.status !== 'ACTIVE') {
    return { error: 'OIDC linking approval can only be managed for active users.' };
  }

  const identifier = user.email.toLowerCase();
  const state = await readOidcLinkingState(user.id, identifier);
  if (state === 'linked') {
    return {
      error:
        'This user already has an OIDC identity linked. Revoking approval does not unlink identities.',
      alreadyLinked: true,
      state,
    };
  }

  // ACTIVE users no longer need invite credentials. Removing their INVITE
  // records removes the administrator-provisioning evidence used by #336, so
  // a future first-time OIDC link is denied again without affecting password
  // authentication, role, or account status.
  await prisma.oidcLinkingApproval.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await logAudit({
    action: 'user.oidc_linking.revoked',
    entityType: 'USER',
    entityId: user.id,
    actorId: admin.id,
    details: { email: identifier },
  });

  logger.info('[Auth] Admin revoked first-time OIDC linking approval', {
    component: 'users-actions',
    userId: user.id,
    email: identifier,
    adminId: admin.id,
  });

  revalidatePath('/users');
  revalidatePath('/audit');
  return { success: true, state: 'not-approved' };
}
