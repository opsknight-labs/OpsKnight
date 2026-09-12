'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import { normalizeOidcIssuer, getLegacyOidcIssuerVariants } from '@/lib/oidc/issuer-migration';
import {
  getOidcLinkingApprovalExpiry,
  getOidcLinkingApprovalState,
  type OidcLinkingApprovalState,
} from '@/lib/oidc-linking-approval';

export type OidcLinkingState = OidcLinkingApprovalState | 'linked';

export type OidcLinkingApprovalResult = {
  success?: boolean;
  alreadyLinked?: boolean;
  alreadyApproved?: boolean;
  renewed?: boolean;
  state?: OidcLinkingState;
  error?: string;
};

async function getManagedUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true },
  });
}

async function getActiveProviderConfig() {
  return prisma.oidcConfig.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, issuer: true, clientId: true, configVersion: true, enabled: true },
  });
}

type ActiveProvider = NonNullable<Awaited<ReturnType<typeof getActiveProviderConfig>>>;

async function readOidcLinkingState(
  userId: string,
  now = new Date(),
  activeProvider?: ActiveProvider | null
): Promise<OidcLinkingState> {
  const provider = activeProvider !== undefined ? activeProvider : await getActiveProviderConfig();

  // Link state is scoped to the current provider trust boundary.
  // A historical identity for an old/migrated issuer does not satisfy the active provider.
  if (provider?.enabled && provider.issuer) {
    const canonicalIssuer = normalizeOidcIssuer(provider.issuer);
    const issuerVariants = [canonicalIssuer, ...getLegacyOidcIssuerVariants(canonicalIssuer)];
    const existingIdentity = await prisma.oidcIdentity.findFirst({
      where: {
        userId,
        issuer: { in: issuerVariants },
      },
      select: { id: true },
    });
    if (existingIdentity) return 'linked';
  } else if (!provider) {
    // If no provider exists at all, fall back to checking if user has any identity
    const existingIdentity = await prisma.oidcIdentity.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (existingIdentity) return 'linked';
  }

  const approval = await prisma.oidcLinkingApproval.findUnique({
    where: { userId },
    select: {
      id: true,
      revokedAt: true,
      consumedAt: true,
      expiresAt: true,
      providerConfigId: true,
      issuerFingerprint: true,
      configVersion: true,
    },
  });

  const providerContext =
    provider && provider.enabled && provider.issuer
      ? {
          providerConfigId: provider.id,
          issuerFingerprint: oidcTrustFingerprint(provider.issuer, provider.clientId),
          configVersion: provider.configVersion,
        }
      : null;

  return getOidcLinkingApprovalState(approval, now, providerContext);
}

export async function getOidcLinkingState(userId: string): Promise<OidcLinkingApprovalResult> {
  try {
    await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const user = await getManagedUser(userId);
  if (!user) return { error: 'User not found.' };

  const state = await readOidcLinkingState(user.id);
  return { success: true, state, alreadyLinked: state === 'linked' };
}

/**
 * Explicitly authorizes first-time OIDC linking for an ACTIVE or INVITED user
 * without changing the account status or issuing a usable invitation link.
 * Expired or revoked approvals are renewed in-place so generation advances and
 * stale callbacks cannot reuse the prior authorization.
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
  if (user.status !== 'ACTIVE' && user.status !== 'INVITED') {
    return { error: 'OIDC linking approval can only be managed for active or invited users.' };
  }

  const provider = await getActiveProviderConfig();
  if (!provider?.enabled || !provider.issuer) {
    return { error: 'An active OIDC configuration is required.' };
  }

  const identifier = user.email.toLowerCase();
  const now = new Date();
  const state = await readOidcLinkingState(user.id, now, provider);
  if (state === 'linked') {
    return { success: true, alreadyLinked: true, state };
  }
  if (state === 'approved') {
    return { success: true, alreadyApproved: true, state };
  }

  const expiresAt = getOidcLinkingApprovalExpiry(now);
  const renewed =
    state === 'expired' || state === 'revoked' || state === 'consumed' || state === 'stale';
  const issuerFingerprint = oidcTrustFingerprint(provider.issuer, provider.clientId);

  await prisma.oidcLinkingApproval.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      approvedById: admin.id,
      approvedAt: now,
      expiresAt,
      providerConfigId: provider.id,
      issuerFingerprint,
      expectedEmail: identifier,
      configVersion: provider.configVersion,
    },
    update: {
      approvedById: admin.id,
      approvedAt: now,
      revokedAt: null,
      consumedAt: null,
      providerConfigId: provider.id,
      issuerFingerprint,
      expectedEmail: identifier,
      configVersion: provider.configVersion,
      expiresAt,
      generation: { increment: 1 },
    },
  });

  await logAudit({
    action: renewed ? 'user.oidc_linking.renewed' : 'user.oidc_linking.approved',
    entityType: 'USER',
    entityId: user.id,
    actorId: admin.id,
    details: {
      email: identifier,
      outcome: 'approved',
      previousState: state,
      expiresAt: expiresAt.toISOString(),
    },
  });

  logger.info(
    renewed
      ? '[Auth] Admin renewed first-time OIDC linking approval'
      : '[Auth] Admin approved first-time OIDC linking',
    {
      component: 'users-actions',
      userId: user.id,
      adminId: admin.id,
      previousState: state,
      expiresAt: expiresAt.toISOString(),
    }
  );

  revalidatePath('/users');
  revalidatePath('/audit');
  return { success: true, state: 'approved', renewed };
}

/**
 * Revokes first-time OIDC linking eligibility for an ACTIVE or INVITED user
 * that has not linked an OIDC identity yet. Existing credentials and account
 * status are not changed. A linked identity must be managed separately; this
 * action never silently unlinks an established identity.
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
  if (user.status !== 'ACTIVE' && user.status !== 'INVITED') {
    return { error: 'OIDC linking approval can only be managed for active or invited users.' };
  }

  const identifier = user.email.toLowerCase();
  const state = await readOidcLinkingState(user.id);
  if (state === 'linked') {
    return {
      error:
        'This user already has an OIDC identity linked. Revoking approval does not unlink identities.',
      alreadyLinked: true,
      state,
    };
  }

  if (state === 'revoked' || state === 'consumed' || state === 'not-approved') {
    return { success: true, state };
  }

  await prisma.oidcLinkingApproval.updateMany({
    where: { userId: user.id, revokedAt: null, consumedAt: null },
    data: { revokedAt: new Date() },
  });

  await logAudit({
    action: 'user.oidc_linking.revoked',
    entityType: 'USER',
    entityId: user.id,
    actorId: admin.id,
    details: { email: identifier, outcome: 'revoked', previousState: state },
  });

  logger.info('[Auth] Admin revoked first-time OIDC linking approval', {
    component: 'users-actions',
    userId: user.id,
    adminId: admin.id,
    previousState: state,
  });

  revalidatePath('/users');
  revalidatePath('/audit');
  return { success: true, state: 'revoked' };
}
