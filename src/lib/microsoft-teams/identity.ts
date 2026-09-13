import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type TeamsUserIdentity = {
  tenantId: string;
  providerUserId: string;
  aadObjectId?: string | null;
  displayName?: string | null;
};

export async function resolveMicrosoftTeamsUser(identity: TeamsUserIdentity) {
  const byObject = identity.aadObjectId
    ? await prisma.chatIdentityLink.findUnique({
        where: {
          provider_providerTenantId_providerObjectId: {
            provider: 'MICROSOFT_TEAMS',
            providerTenantId: identity.tenantId,
            providerObjectId: identity.aadObjectId,
          },
        },
        include: { user: { select: { id: true, name: true, status: true } } },
      })
    : null;
  const byUser = await prisma.chatIdentityLink.findUnique({
    where: {
      provider_providerTenantId_providerUserId: {
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: identity.tenantId,
        providerUserId: identity.providerUserId,
      },
    },
    include: { user: { select: { id: true, name: true, status: true } } },
  });
  if (byObject && byUser && byObject.id !== byUser.id) throw new Error('Teams identity link mismatch');
  const link = byObject ?? byUser;
  if (!link || link.revokedAt || link.user.status !== 'ACTIVE') return null;
  if (link.providerUserId !== identity.providerUserId) throw new Error('Teams provider user identity mismatch');
  return { linkId: link.id, userId: link.user.id, displayName: link.user.name };
}

export async function createMicrosoftTeamsIdentityChallenge(identity: TeamsUserIdentity): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashIdentityChallenge(token);
  await prisma.chatIdentityChallenge.create({
    data: {
      tokenHash,
      provider: 'MICROSOFT_TEAMS',
      providerTenantId: identity.tenantId,
      providerUserId: identity.providerUserId,
      providerObjectId: identity.aadObjectId ?? null,
      displayName: identity.displayName?.trim().slice(0, 255) || null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return token;
}

export function hashIdentityChallenge(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function consumeMicrosoftTeamsIdentityChallenge(token: string, userId: string) {
  const tokenHash = hashIdentityChallenge(token);
  return prisma.$transaction(async tx => {
    const challenge = await tx.chatIdentityChallenge.findUnique({ where: { tokenHash } });
    if (!challenge || challenge.provider !== 'MICROSOFT_TEAMS' || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new Error('This Microsoft Teams account-link request is invalid or expired.');
    }
    const consumed = await tx.chatIdentityChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new Error('This Microsoft Teams account-link request was already used.');
    return tx.chatIdentityLink.upsert({
      where: {
        provider_providerTenantId_providerUserId: {
          provider: 'MICROSOFT_TEAMS',
          providerTenantId: challenge.providerTenantId,
          providerUserId: challenge.providerUserId,
        },
      },
      create: {
        provider: 'MICROSOFT_TEAMS', providerTenantId: challenge.providerTenantId,
        providerUserId: challenge.providerUserId, providerObjectId: challenge.providerObjectId,
        userId, displayName: challenge.displayName, verificationMethod: 'ACCOUNT_LINK',
      },
      update: {
        userId, providerObjectId: challenge.providerObjectId, displayName: challenge.displayName,
        verificationMethod: 'ACCOUNT_LINK', verifiedAt: new Date(), revokedAt: null,
      },
    });
  });
}
