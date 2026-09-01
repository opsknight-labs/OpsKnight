import 'server-only';

import { createHash, randomBytes } from 'crypto';
import type { Prisma, Role, UserStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  dependencySummary,
  discoverUserDependenciesInTransaction,
} from '@/lib/users/dependencies';
import {
  bulkUpdateUserSecurityState,
  updateUserSecurityState,
} from '@/lib/users/admin-invariants';

type SecurityMutationSideEffects = (tx: Prisma.TransactionClient) => Promise<void>;

type InviteUserInput = {
  name: string;
  email: string;
  role: Role;
};

function makeInviteCredential() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

function inviteUrl(token: string) {
  return `${getBaseUrl()}/set-password?token=${encodeURIComponent(token)}`;
}

export async function createInvitedUser(input: InviteUserInput) {
  const email = input.email.toLowerCase();
  const credential = makeInviteCredential();

  const user = await runSerializableTransaction(async tx => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email,
        role: input.role,
        status: 'INVITED',
        invitedAt: new Date(),
        invitationGeneration: 1,
      },
    });

    await tx.userToken.updateMany({
      where: { identifier: email, type: 'INVITE', usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.userToken.create({
      data: {
        identifier: email,
        userId: created.id,
        generation: created.invitationGeneration,
        type: 'INVITE',
        tokenHash: credential.tokenHash,
        expiresAt: credential.expiresAt,
      },
    });

    return created;
  });

  return { user, inviteUrl: inviteUrl(credential.token) };
}

export async function rotateUserInvite(userId: string, email: string) {
  const credential = makeInviteCredential();
  const identifier = email.toLowerCase();

  await runSerializableTransaction(async tx => {
    const rotated = await tx.user.update({
      where: { id: userId, status: 'INVITED' },
      data: { invitedAt: new Date(), invitationGeneration: { increment: 1 } },
      select: { invitationGeneration: true },
    });

    await tx.userToken.updateMany({
      where: { userId, type: 'INVITE', usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.userToken.create({
      data: {
        identifier,
        userId,
        generation: rotated.invitationGeneration,
        type: 'INVITE',
        tokenHash: credential.tokenHash,
        expiresAt: credential.expiresAt,
      },
    });
  });

  return inviteUrl(credential.token);
}

async function revokeInteractiveCredentials(tx: Prisma.TransactionClient, userIds: string[]) {
  const revokedAt = new Date();
  await tx.userToken.updateMany({
    where: { userId: { in: userIds }, usedAt: null, revokedAt: null },
    data: { revokedAt },
  });
  await tx.apiKey.updateMany({
    where: { userId: { in: userIds }, revokedAt: null },
    data: { revokedAt },
  });
  await tx.oidcLinkingApproval.updateMany({
    where: { userId: { in: userIds }, revokedAt: null },
    data: { revokedAt },
  });
  await tx.userDevice.deleteMany({ where: { userId: { in: userIds } } });
}

export async function deactivateUserAccount(userId: string) {
  return updateUserSecurityState(
    userId,
    { status: 'DISABLED' },
    {
      deactivatedAt: new Date(),
      tokenVersion: { increment: 1 },
      invitationGeneration: { increment: 1 },
    },
    tx => revokeInteractiveCredentials(tx, [userId])
  );
}

export async function deactivateUserAccounts(userIds: string[]) {
  const ids = [...new Set(userIds)];
  return bulkUpdateUserSecurityState(
    ids,
    { status: 'DISABLED' },
    {
      deactivatedAt: new Date(),
      tokenVersion: { increment: 1 },
      invitationGeneration: { increment: 1 },
    },
    tx => revokeInteractiveCredentials(tx, ids)
  );
}

export async function reactivateUserAccount(userId: string) {
  return runSerializableTransaction(async tx => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, passwordHash: true },
    });
    if (!target) throw new Error('User not found.');
    if (target.status !== 'DISABLED') throw new Error('Only disabled users can be reactivated.');

    const nextStatus: UserStatus = target.passwordHash ? 'ACTIVE' : 'INVITED';
    const updated = await tx.user.updateMany({
      where: { id: userId, status: 'DISABLED' },
      data: {
        status: nextStatus,
        deactivatedAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error('User state changed while reactivating. Retry.');

    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
}

export async function updateUserRoleAccount(
  userId: string,
  role: Role,
  additionalData: Prisma.UserUpdateInput = { tokenVersion: { increment: 1 } },
  sideEffects?: SecurityMutationSideEffects
) {
  return updateUserSecurityState(userId, { role }, additionalData, sideEffects);
}

export async function updateUserRoleAccounts(userIds: string[], role: Role) {
  return bulkUpdateUserSecurityState(
    [...new Set(userIds)],
    { role },
    { tokenVersion: { increment: 1 } }
  );
}

export async function deleteUserAccount(userId: string) {
  return runSerializableTransaction(async tx => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user) throw new Error('User not found.');
    if (user.status !== 'DISABLED') {
      throw new Error('Deactivate the user before permanent deletion.');
    }

    const dependencies = dependencySummary(
      await discoverUserDependenciesInTransaction(tx, userId)
    );
    if (dependencies.length > 0) {
      throw new Error(
        `Resolve or transfer user dependencies before deletion (${dependencies.join(', ')}).`
      );
    }

    // Historical evidence is preserved according to USER_REFERENCE_POLICY; operational
    // references must already be cleared by the dependency gate above.
    await tx.incidentNote.updateMany({ where: { userId }, data: { userId: null } });
    await tx.incidentWatcher.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    return { id: userId };
  });
}
