import 'server-only';

import type { Prisma } from '@prisma/client';

export type OperationalUserErrorFactory = () => Error;

/**
 * Authoritative eligibility check for assigning operational responsibility to a user.
 * Callers must invoke this inside the same Serializable transaction as the assignment write.
 */
export async function requireOperationalUser(
  tx: Prisma.TransactionClient,
  userId: string,
  errorFactory?: OperationalUserErrorFactory
) {
  const user = await tx.user.findFirst({
    where: { id: userId, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  if (!user) {
    throw errorFactory?.() ?? new Error('Operational assignments require an active user.');
  }
  return user;
}
