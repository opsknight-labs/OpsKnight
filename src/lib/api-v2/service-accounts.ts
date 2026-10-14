import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { hashTokenV2 } from '@/lib/api-keys';
import { isAppRole, isApiScope, type ApiScope, type AppRole } from '@/lib/authorization';
import { disallowedScopesForRole } from '@/lib/api-scope-registry';
import { AppError } from '@/lib/errors';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { logV2Audit, runV2AuditedMutation } from './audit';
import { SERVICE_ACCOUNT_DOMAIN, isServiceAccountEmail } from '@/lib/service-account-identity';
import { invalidateV2AuthCache } from './auth';

export { SERVICE_ACCOUNT_DOMAIN };

export interface CreateServiceAccountInput {
  name: string;
  role: AppRole;
  description?: string;
  teamIds?: string[];
  actorId: string;
  /** Join an existing transaction (e.g. the idempotency transaction). */
  tx?: Prisma.TransactionClient;
}

export interface IssueServiceAccountTokenInput {
  serviceAccountId: string;
  name: string;
  scopes: string[];
  expiresInDays?: number;
  /** Explicit administrative decision to issue a token that never expires. */
  neverExpires?: boolean;
  actorId: string;
}

/**
 * Token lifetime policy. A non-expiring token is allowed only when the caller says so
 * (`neverExpires`) and the deployment has not forbidden it. Lifetimes are capped so a
 * forgotten token cannot outlive the deployment's rotation policy.
 */
export function resolveTokenExpiry(
  input: Pick<IssueServiceAccountTokenInput, 'expiresInDays' | 'neverExpires'>,
  now = Date.now()
): Date | null {
  const allowNonExpiring = process.env.API_V2_ALLOW_NON_EXPIRING_TOKENS !== 'false';
  const maxDays = Number.parseInt(process.env.API_V2_TOKEN_MAX_DAYS ?? '', 10);

  if (input.neverExpires && input.expiresInDays !== undefined) {
    throw new AppError({
      code: 'INVALID_TOKEN_EXPIRY',
      userMessage: 'Provide either expiresInDays or neverExpires, not both.',
    });
  }
  if (input.neverExpires) {
    if (!allowNonExpiring || (Number.isFinite(maxDays) && maxDays > 0)) {
      throw new AppError({
        code: 'INVALID_TOKEN_EXPIRY',
        userMessage: 'Non-expiring tokens are disabled by this deployment. Provide expiresInDays.',
      });
    }
    return null;
  }
  if (!input.expiresInDays || input.expiresInDays <= 0) {
    throw new AppError({
      code: 'INVALID_TOKEN_EXPIRY',
      userMessage: 'Choose a token lifetime: provide expiresInDays, or neverExpires: true.',
    });
  }
  if (Number.isFinite(maxDays) && maxDays > 0 && input.expiresInDays > maxDays) {
    throw new AppError({
      code: 'INVALID_TOKEN_EXPIRY',
      userMessage: `Token lifetime may not exceed ${maxDays} days on this deployment.`,
    });
  }
  return new Date(now + input.expiresInDays * 86_400_000);
}

export async function listServiceAccounts() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}`, mode: 'insensitive' } },
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

  if (!user || !isServiceAccountEmail(user.email)) {
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
  if (!isAppRole(input.role)) {
    throw new AppError({
      code: 'INVALID_SERVICE_ACCOUNT_ROLE',
      userMessage:
        "Service account role must be a valid system role ('ADMIN', 'RESPONDER', 'AUDITOR', or 'USER').",
    });
  }

  const uniqueId = randomBytes(4).toString('hex');
  const safeName = input.name.trim();
  const email = `sa_${Date.now()}_${uniqueId}@${SERVICE_ACCOUNT_DOMAIN}`;

  if (input.teamIds && input.teamIds.length > 0) {
    const found = await (input.tx ?? prisma).team.findMany({
      where: { id: { in: input.teamIds } },
      select: { id: true },
    });
    const missing = input.teamIds.filter(id => !found.some(team => team.id === id));
    if (missing.length > 0) {
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        userMessage: `Team(s) not found: ${missing.join(', ')}.`,
        details: { missingTeamIds: missing },
      });
    }
  }

  const createdUser = await runV2AuditedMutation(
    tx =>
      tx.user.create({
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
      }),
    created => ({
      action: 'service_account.created',
      entityType: 'USER',
      entityId: created.id,
      actorId: input.actorId,
      details: {
        name: created.name,
        role: created.role,
        teamIds: input.teamIds ?? [],
      },
    }),
    input.tx
  );

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
      await logV2Audit({
        action: 'service_account.deleted',
        entityType: 'USER',
        entityId: id,
        actorId,
        details: { name: sa.name, email: sa.email },
        tx,
      });
    }
  );

  invalidateV2AuthCache();

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
  const account = await getServiceAccount(input.serviceAccountId);

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

  const invalidScopes = input.scopes.filter(s => !isApiScope(s));
  if (invalidScopes.length > 0) {
    throw new AppError({
      code: 'INVALID_TOKEN_SCOPES',
      userMessage: `Invalid scopes provided: ${invalidScopes.join(', ')}. Scopes must be recognized in the API scope registry.`,
      details: { invalidScopes },
    });
  }

  // Least privilege: a token may not carry scopes its service account's role could not hold,
  // nor scopes that currently grant nothing.
  const disallowed = disallowedScopesForRole(account.role, input.scopes as ApiScope[]);
  if (disallowed.length > 0) {
    throw new AppError({
      code: 'INVALID_TOKEN_SCOPES',
      userMessage: `Scopes not permitted for a ${account.role} service account: ${disallowed.join(', ')}.`,
      details: { disallowedScopes: disallowed },
    });
  }

  const { token, prefix, tokenHash } = generateServiceAccountTokenRaw();
  const expiresAt = resolveTokenExpiry(input);

  const apiKey = await runV2AuditedMutation(
    tx =>
      tx.apiKey.create({
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
      }),
    created => ({
      action: 'service_account_token.created',
      entityType: 'API_KEY',
      entityId: created.id,
      actorId: input.actorId,
      details: {
        serviceAccountId: input.serviceAccountId,
        tokenName: created.name,
        prefix: created.prefix,
        scopes: created.scopes,
        expiresAt: created.expiresAt?.toISOString() ?? null,
        neverExpires: created.expiresAt === null,
      },
    })
  );

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

  await runV2AuditedMutation(
    tx =>
      tx.apiKey.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
      }),
    () => ({
      action: 'service_account_token.revoked',
      entityType: 'API_KEY',
      entityId: tokenId,
      actorId,
      details: {
        serviceAccountId,
        tokenName: apiKey.name,
        prefix: apiKey.prefix,
      },
    })
  );

  invalidateV2AuthCache(apiKey.tokenHash);

  return { success: true };
}
