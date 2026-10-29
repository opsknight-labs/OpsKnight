import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import { requireUserAdministrator, type UserAdministrationActor } from './administration';

export const invitationReviewInput = z
  .object({
    authenticationMode: z.enum(['PASSWORD', 'SSO']),
    delivery: z.enum(['EMAIL', 'MANUAL']),
    expectedPolicyVersion: z.number().int().min(1).max(2147483647),
    expectedOidcConfigVersion: z.number().int().min(1).max(2147483647).nullable(),
  })
  .strict();
export const invitationCreateInput = invitationReviewInput
  .extend({
    name: z.string().trim().min(1).max(200),
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform(value => value.toLowerCase()),
    role: z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']),
  })
  .strict();
export const invitationRenewInput = invitationReviewInput
  .extend({
    expectedLinkingApprovalRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
export const linkingApprovalSelect = {
  id: true,
  userId: true,
  generation: true,
  approvedById: true,
  approvedAt: true,
  providerConfigId: true,
  issuerFingerprint: true,
  expectedEmail: true,
  configVersion: true,
  expiresAt: true,
  consumedAt: true,
  revokedAt: true,
} satisfies Prisma.OidcLinkingApprovalSelect;
type LinkingApprovalState = Prisma.OidcLinkingApprovalGetPayload<{
  select: typeof linkingApprovalSelect;
}>;
/** Covers all approval writers without falsely claiming that the User ETag covers a child row. */
export function linkingApprovalRevision(approval: LinkingApprovalState | null): string | null {
  return approval ? createHash('sha256').update(JSON.stringify(approval)).digest('hex') : null;
}
export async function readInvitationPolicy(
  tx: Prisma.TransactionClient,
  actor: UserAdministrationActor
) {
  await requireUserAdministrator(tx, actor);
  const policy = await tx.authenticationPolicy.findUnique({ where: { id: 'default' } });
  if (!policy)
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'Initialize the authentication policy before inviting users.',
    });
  const provider = await tx.oidcConfig.findUnique({
    where: { id: 'default' },
    select: { enabled: true, configVersion: true },
  });
  return {
    mode: policy.mode,
    policyVersion: policy.version,
    passwordInvitationsAllowed: evaluateAuthenticationPolicy(policy, 'PASSWORD_WRITE').allowed,
    ssoInvitationsAllowed:
      evaluateAuthenticationPolicy(policy, 'OIDC_LOGIN').allowed && Boolean(provider?.enabled),
    oidcConfigVersion: provider?.enabled ? provider.configVersion : null,
  };
}
export type InvitationDeliveryPolicy = {
  userId: string;
  email: string;
  invitationGeneration: number;
  authenticationMode: 'PASSWORD' | 'SSO';
  approvalGeneration?: number;
};
const deliveryPolicyInput = z
  .object({
    userId: z.string().cuid(),
    email: z.string().email().max(320),
    invitationGeneration: z.number().int().min(1),
    authenticationMode: z.enum(['PASSWORD', 'SSO']),
    approvalGeneration: z.number().int().min(1).optional(),
  })
  .strict();
/** Fail closed at dispatch; acceptance, renewal, revocation and provider changes supersede queued mail. */
export async function invitationDeliveryRevoked(
  raw: unknown,
  recipient: string,
  now = new Date()
): Promise<string | null> {
  const parsed = deliveryPolicyInput.safeParse(raw);
  if (!parsed.success) return 'Invitation delivery policy is invalid.';
  const input = parsed.data;
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { status: true, email: true, invitationGeneration: true },
  });
  if (
    !user ||
    user.status !== 'INVITED' ||
    user.email.toLowerCase() !== input.email.toLowerCase() ||
    recipient.toLowerCase() !== input.email.toLowerCase() ||
    user.invitationGeneration !== input.invitationGeneration
  )
    return 'Invitation was superseded or its recipient changed.';
  const policy = await prisma.authenticationPolicy.findUnique({ where: { id: 'default' } });
  if (!policy) return 'Invitation authentication policy is unavailable.';
  if (input.authenticationMode === 'PASSWORD') {
    if (!evaluateAuthenticationPolicy(policy, 'PASSWORD_WRITE').allowed)
      return 'Password invitations are no longer allowed.';
    const token = await prisma.userToken.findFirst({
      where: {
        userId: input.userId,
        identifier: user.email.toLowerCase(),
        generation: input.invitationGeneration,
        type: 'INVITE',
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    return token ? null : 'Invitation capability expired or was revoked.';
  }
  if (!evaluateAuthenticationPolicy(policy, 'OIDC_LOGIN').allowed)
    return 'SSO invitations are no longer allowed.';
  const [approval, provider] = await Promise.all([
    prisma.oidcLinkingApproval.findUnique({
      where: { userId: input.userId },
      select: linkingApprovalSelect,
    }),
    prisma.oidcConfig.findUnique({
      where: { id: 'default' },
      select: { id: true, enabled: true, issuer: true, clientId: true, configVersion: true },
    }),
  ]);
  if (
    !approval ||
    !provider?.enabled ||
    !input.approvalGeneration ||
    approval.generation !== input.approvalGeneration ||
    approval.revokedAt ||
    approval.consumedAt ||
    !approval.expiresAt ||
    approval.expiresAt <= now ||
    approval.expectedEmail?.toLowerCase() !== user.email.toLowerCase() ||
    approval.providerConfigId !== provider.id ||
    approval.configVersion !== provider.configVersion ||
    approval.issuerFingerprint !== oidcTrustFingerprint(provider.issuer, provider.clientId)
  )
    return 'SSO invitation approval expired, changed or was revoked.';
  return null;
}

export async function readUserInvitation(
  tx: Prisma.TransactionClient,
  userId: string,
  actor: UserAdministrationActor
) {
  await requireUserAdministrator(tx, actor);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      revision: true,
      invitationGeneration: true,
    },
  });
  if (!user) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
  const [approval, token, delivery] = await Promise.all([
    tx.oidcLinkingApproval.findUnique({ where: { userId }, select: linkingApprovalSelect }),
    tx.userToken.findFirst({
      where: {
        userId,
        type: 'INVITE',
        generation: user.invitationGeneration,
        usedAt: null,
        revokedAt: null,
      },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    }),
    tx.notification.findFirst({
      where: { sourceType: 'USER_INVITATION', sourceId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    }),
  ]);
  const activeApproval = approval && !approval.revokedAt && !approval.consumedAt;
  return {
    userId,
    revision: user.revision,
    status: user.status,
    invitationGeneration: user.invitationGeneration,
    linkingApprovalRevision: linkingApprovalRevision(approval),
    authenticationMode: activeApproval ? ('SSO' as const) : token ? ('PASSWORD' as const) : null,
    expiresAt: activeApproval ? approval.expiresAt : (token?.expiresAt ?? null),
    delivery: delivery ? { notificationId: delivery.id, status: delivery.status } : null,
  };
}
