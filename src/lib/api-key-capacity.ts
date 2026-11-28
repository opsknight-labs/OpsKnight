import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';

/** Rate limits are per key, so an unbounded number of keys per user would multiply them. */
export const MAX_ACTIVE_API_KEYS_PER_USER = 25;

/**
 * Refuses a new key when the user already holds the maximum number of active keys (not revoked,
 * not expired). Call inside the transaction that creates the key: the user row is locked so two
 * concurrent creations cannot both slip under the cap.
 */
export async function assertApiKeyCapacity(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const active = await tx.apiKey.count({
    where: {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (active >= MAX_ACTIVE_API_KEYS_PER_USER) {
    throw new AppError({
      code: 'API_KEY_LIMIT_REACHED',
      userMessage: `This account already has ${MAX_ACTIVE_API_KEYS_PER_USER} active API keys, the maximum. Revoke or wait for one to expire before creating another.`,
      details: { limit: MAX_ACTIVE_API_KEYS_PER_USER },
    });
  }
}
