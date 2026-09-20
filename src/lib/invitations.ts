import { randomBytes, createHash } from 'crypto';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';

export async function buildInviteUrl(token: string): Promise<string> {
  const appUrl = (await getAppUrl()).replace(/\/$/, '');
  return `${appUrl}/set-password#token=${encodeURIComponent(token)}`;
}

export async function issueUserInviteToken(
  userId: string,
  email: string
): Promise<{ token: string; inviteUrl: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const identifier = email.toLowerCase();

  await prisma.$transaction(async tx => {
    const rotated = await tx.user.update({
      where: { id: userId, status: 'INVITED' },
      data: { invitedAt: new Date(), invitationGeneration: { increment: 1 } },
      select: { invitationGeneration: true },
    });
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
        generation: rotated.invitationGeneration,
        type: 'INVITE',
        tokenHash,
        expiresAt,
      },
    });
  });

  const inviteUrl = await buildInviteUrl(token);
  return { token, inviteUrl, expiresAt };
}
