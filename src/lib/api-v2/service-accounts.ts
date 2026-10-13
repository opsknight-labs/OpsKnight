import { randomBytes } from 'node:crypto';
import prisma from '@/lib/prisma';
import { hashTokenV2 } from '@/lib/api-keys';
import { isAppRole, type AppRole } from '@/lib/authorization';
import { AppError } from '@/lib/errors';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { logV2Audit } from './audit';
import { invalidateV2AuthCache } from './auth';

export const SERVICE_ACCOUNT_DOMAIN = 'serviceaccount.opsknight.local';

export interface CreateServiceAccountInput {
  name: string;
  role: AppRole;
  description?: string;
  teamIds?: string[];
  actorId: string;
}

export interface IssueServiceAccountTokenInput {
  serviceAccountId: string;
  name: string;
  scopes: string[];
  expiresInDays?: number;
  actorId: string;
}

export async function listServiceAccounts() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { department: 'SERVICE_ACCOUNT' },
        { jobTitle: 'Service Account' },
        { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}` } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      teamMemberships: {
        select: {
          team: {
            select: { id: true, name: true },
          },
        },
      },
      apiKeys: {
        where: { revokedAt: null },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
        },
      },
    },
  });

  return users.map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    teams: user.teamMemberships.map(tm => tm.team),
    activeTokensCount: user.apiKeys.length,
    tokens: user.apiKeys,
  }));
}

export async function getServiceAccount(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      department: true,
      jobTitle: true,
      createdAt: true,
      updatedAt: true,
      teamMemberships: {
        select: {
          team: {
            select: { id: true, name: true },
          },
        },
      },
      apiKeys: {
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (
    !user ||
    (user.department !== 'SERVICE_ACCOUNT' &&
      user.jobTitle !== 'Service Account' &&
      !user.email.endsWith(`@${SERVICE_ACCOUNT_DOMAIN}`))
  ) {
    throw new AppError({
      code: 'SERVICE_ACCOUNT_NOT_FOUND',
      userMessage: `Service account with id '${id}' not found.`,
    });
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    teams: user.teamMemberships.map(tm => tm.team),
    tokens: user.apiKeys,
  };
}

export async function createServiceAccount(input: CreateServiceAccountInput) {
  if (!isAppRole(input.role) || input.role === 'USER') {
    throw new AppError({
      code: 'INVALID_SERVICE_ACCOUNT_ROLE',
      userMessage: "Service account role must be 'ADMIN', 'RESPONDER', or 'AUDITOR'.",
    });
  }

  const uniqueId = randomBytes(4).toString('hex');
  const safeName = input.name.trim();
  const email = `sa_${Date.now()}_${uniqueId}@${SERVICE_ACCOUNT_DOMAIN}`;

  const createdUser = await prisma.user.create({
    data: {
      name: safeName,
      email,
      role: input.role,
      status: 'ACTIVE',
      department: 'SERVICE_ACCOUNT',
      jobTitle: 'Service Account',
      ...(input.teamIds && input.teamIds.length > 0
        ? {
            teamMemberships: {
              createMany: {
                data: input.teamIds.map(teamId => ({ teamId })),
                skipDuplicates: true,
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      teamMemberships: {
        select: {
          team: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  await logV2Audit({
    action: 'service_account.created',
    entityType: 'USER',
    entityId: createdUser.id,
    actorId: input.actorId,
    details: {
      name: createdUser.name,
      role: createdUser.role,
      teamIds: input.teamIds ?? [],
    },
  });

  return {
    id: createdUser.id,
    name: createdUser.name,
    email: createdUser.email,
    role: createdUser.role,
    status: createdUser.status,
    createdAt: createdUser.createdAt,
    updatedAt: createdUser.updatedAt,
    teams: createdUser.teamMemberships.map(tm => tm.team),
  };
}

export async function deleteServiceAccount(id: string, actorId: string) {
  const sa = await getServiceAccount(id);

  await updateUserSecurityState(
    id,
    { status: 'DISABLED' },
    { deactivatedAt: new Date() },
    async tx => {
      // Revoke all tokens within the transaction
      await tx.apiKey.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  );

  invalidateV2AuthCache();

  await logV2Audit({
    action: 'service_account.deleted',
    entityType: 'USER',
    entityId: id,
    actorId,
    details: { name: sa.name, email: sa.email },
  });

  return { success: true };
}

export function generateServiceAccountTokenRaw() {
  const raw = randomBytes(32).toString('base64url');
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const token = `ok_sa_${env}_${raw}`;
  return {
    token,
    prefix: token.slice(0, 15),
    tokenHash: hashTokenV2(token),
  };
}

export async function issueServiceAccountToken(input: IssueServiceAccountTokenInput) {
  await getServiceAccount(input.serviceAccountId);

  if (!input.name || input.name.trim().length === 0) {
    throw new AppError({
      code: 'INVALID_TOKEN_NAME',
      userMessage: 'Token name is required.',
    });
  }

  if (!input.scopes || input.scopes.length === 0) {
    throw new AppError({
      code: 'INVALID_TOKEN_SCOPES',
      userMessage: 'At least one valid scope must be assigned to the token.',
    });
  }

  const { token, prefix, tokenHash } = generateServiceAccountTokenRaw();
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

  const apiKey = await prisma.apiKey.create({
    data: {
      name: input.name.trim(),
      prefix,
      tokenHash,
      scopes: input.scopes,
      userId: input.serviceAccountId,
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  await logV2Audit({
    action: 'service_account_token.created',
    entityType: 'API_KEY',
    entityId: apiKey.id,
    actorId: input.actorId,
    details: {
      serviceAccountId: input.serviceAccountId,
      tokenName: apiKey.name,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    },
  });

  return {
    token, // Provided once on issuance
    apiKey,
  };
}

export async function revokeServiceAccountToken(
  serviceAccountId: string,
  tokenId: string,
  actorId: string
) {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: tokenId, userId: serviceAccountId },
  });

  if (!apiKey) {
    throw new AppError({
      code: 'TOKEN_NOT_FOUND',
      userMessage: `Token with id '${tokenId}' not found for this service account.`,
    });
  }

  await prisma.apiKey.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });

  invalidateV2AuthCache(apiKey.tokenHash);

  await logV2Audit({
    action: 'service_account_token.revoked',
    entityType: 'API_KEY',
    entityId: tokenId,
    actorId,
    details: {
      serviceAccountId,
      tokenName: apiKey.name,
      prefix: apiKey.prefix,
    },
  });

  return { success: true };
}
