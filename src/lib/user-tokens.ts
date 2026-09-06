import prisma from '@/lib/prisma';

export type UserTokenCleanupResult = {
  deletedExpired: number;
  deletedUsed: number;
};

/**
 * Cleanup old/expired user tokens.
 *
 * - **expired**: tokens with expiresAt in the past (regardless of usedAt)
 * - **used**: tokens with usedAt set older than `usedRetentionDays`
 *
 * Intended to be safe to run frequently.
 */
export async function cleanupUserTokens(params?: {
  usedRetentionDays?: number;
}): Promise<UserTokenCleanupResult> {
  const usedRetentionDays = params?.usedRetentionDays ?? 30;
  const now = new Date();
  const usedCutoff = new Date(Date.now() - usedRetentionDays * 24 * 60 * 60 * 1000);

  const [expired, used] = await prisma.$transaction([
    prisma.userToken.deleteMany({
      where: {
        expiresAt: { lt: now },
        usedAt: null,
      },
    }),
    prisma.userToken.deleteMany({
      where: {
        usedAt: { not: null, lt: usedCutoff },
      },
    }),
  ]);

  return {
    deletedExpired: expired.count,
    deletedUsed: used.count,
  };
}
