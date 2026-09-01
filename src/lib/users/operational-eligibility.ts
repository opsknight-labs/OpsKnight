import 'server-only';

import type { Prisma } from '@prisma/client';

/** Assignment writers call this inside Serializable transactions shared with lifecycle changes. */
export async function requireOperationalUser(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  if (!user) throw new Error('Operational assignments require an active user.');
  return user;
}
