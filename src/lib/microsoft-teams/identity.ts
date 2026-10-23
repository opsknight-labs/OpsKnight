import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';

import { logger } from '@/lib/logger';

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
  if (byObject && byUser && byObject.id !== byUser.id)
    throw new Error('Teams identity link mismatch');
  const link = byObject ?? byUser;
  if (link && !link.revokedAt && link.user.status === 'ACTIVE') {
    if (link.providerUserId !== identity.providerUserId)
      throw new Error('Teams provider user identity mismatch');
    return { linkId: link.id, userId: link.user.id, displayName: link.user.name };
  }

  // Zero-touch auto-linking: match organisation users by Entra ID (aadObjectId)
  if (identity.aadObjectId) {
    const directoryMatches = await prisma.scimIdentity.findMany({
      where: {
        externalId: identity.aadObjectId,
        deletedAt: null,
        user: { status: 'ACTIVE' },
        connector: { enabled: true, provider: 'ENTRA', tenantId: identity.tenantId },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
      take: 2,
    });
    if (directoryMatches.length > 1) throw new Error('Ambiguous Teams directory identity');
    const matchedUser: { id: string; name: string; email: string } | null =
      directoryMatches[0]?.user ?? null;

    // Email (including a Graph-assured address) is not immutable identity proof.
    // Without a tenant/object match, require the signed-in account-link challenge.
    if (matchedUser) {
      try {
        const autoLink = await prisma.chatIdentityLink.upsert({
          where: {
            provider_providerTenantId_providerUserId: {
              provider: 'MICROSOFT_TEAMS',
              providerTenantId: identity.tenantId,
              providerUserId: identity.providerUserId,
            },
          },
          create: {
            provider: 'MICROSOFT_TEAMS',
            providerTenantId: identity.tenantId,
            providerUserId: identity.providerUserId,
            providerObjectId: identity.aadObjectId,
            userId: matchedUser.id,
            displayName: identity.displayName?.trim() || matchedUser.name,
            verificationMethod: 'OIDC',
            verifiedAt: new Date(),
          },
          update: {
            userId: matchedUser.id,
            providerObjectId: identity.aadObjectId,
            displayName: identity.displayName?.trim() || matchedUser.name,
            verificationMethod: 'OIDC',
            verifiedAt: new Date(),
            revokedAt: null,
          },
        });
        logger.info('[MicrosoftTeams] Auto-linked chat identity for user', {
          userId: matchedUser.id,
          providerUserId: identity.providerUserId,
          aadObjectId: identity.aadObjectId,
        });
        return {
          linkId: autoLink.id,
          userId: matchedUser.id,
          displayName: matchedUser.name,
        };
      } catch (upsertError) {
        logger.warn('[MicrosoftTeams] Auto-link upsert failed', {
          error: (upsertError as Error).message,
        });
      }
    }
  }

  return null;
}

export async function createMicrosoftTeamsIdentityChallenge(
  identity: TeamsUserIdentity
): Promise<string> {
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
    if (
      !challenge ||
      challenge.provider !== 'MICROSOFT_TEAMS' ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    ) {
      throw new Error('This Microsoft Teams account-link request is invalid or expired.');
    }
    const consumed = await tx.chatIdentityChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new Error('This Microsoft Teams account-link request was already used.');
    return tx.chatIdentityLink.upsert({
      where: {
        provider_providerTenantId_providerUserId: {
          provider: 'MICROSOFT_TEAMS',
          providerTenantId: challenge.providerTenantId,
          providerUserId: challenge.providerUserId,
        },
      },
      create: {
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: challenge.providerTenantId,
        providerUserId: challenge.providerUserId,
        providerObjectId: challenge.providerObjectId,
        userId,
        displayName: challenge.displayName,
        verificationMethod: 'ACCOUNT_LINK',
      },
      update: {
        userId,
        providerObjectId: challenge.providerObjectId,
        displayName: challenge.displayName,
        verificationMethod: 'ACCOUNT_LINK',
        verifiedAt: new Date(),
        revokedAt: null,
      },
    });
  });
}
