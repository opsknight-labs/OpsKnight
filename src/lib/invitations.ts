import 'server-only';
import type { Prisma } from '@prisma/client';
import { assertPasswordOperationAllowed } from '@/lib/authentication-policy';
import { randomBytes, createHash } from 'crypto';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';

export function formatInviteUrl(token: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/set-password#token=${encodeURIComponent(token)}`;
}

export async function buildInviteUrl(token: string): Promise<string> {
  return formatInviteUrl(token, await getAppUrl());
}

export async function issueUserInviteToken(
  userId: string,
  email: string
): Promise<{ token: string; inviteUrl: string; expiresAt: Date }> {
  await assertPasswordOperationAllowed();
  const capability = await prisma.$transaction(async tx => {
    await assertPasswordOperationAllowed(tx);
    const rotated = await tx.user.update({
      where: { id: userId, status: 'INVITED' },
      data: { invitedAt: new Date(), invitationGeneration: { increment: 1 } },
      select: { invitationGeneration: true },
    });
    return mintUserInviteCapability(tx, userId, email, rotated.invitationGeneration);
  });

  const inviteUrl = await buildInviteUrl(capability.token);
  return { ...capability, inviteUrl };
}

/** Capability writer shared by authorized UI/REST invitation commands and legacy callers. */
export async function mintUserInviteCapability(
  tx: Prisma.TransactionClient,
  userId: string,
  email: string,
  generation: number
): Promise<{ token: string; expiresAt: Date }> {
  await assertPasswordOperationAllowed(tx);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { status: true, email: true, invitationGeneration: true },
  });
  const identifier = email.toLowerCase();
  if (
    user.status !== 'INVITED' ||
    user.email.toLowerCase() !== identifier ||
    user.invitationGeneration !== generation
  )
    throw new Error('Invitation identity or generation changed.');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await tx.userToken.updateMany({
    where: {
      OR: [{ userId }, { identifier }],
      type: { in: ['INVITE', 'PASSWORD_RESET'] },
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  await tx.userToken.create({
    data: {
      identifier,
      userId,
      generation,
      type: 'INVITE',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt,
    },
  });
  return { token, expiresAt };
}
