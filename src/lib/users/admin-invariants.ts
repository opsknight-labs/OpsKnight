import 'server-only';

import type { Prisma, Role, UserStatus } from '@prisma/client';
import { acquireAdvisoryLock, LOCK_KEYS } from '@/lib/db-locks';
import { runSerializableTransaction } from '@/lib/db-utils';

type UserSecurityMutation = { role?: Role; status?: UserStatus };
type SecurityMutationSideEffects = (tx: Prisma.TransactionClient) => Promise<void>;

export async function updateUserSecurityState(
  userId: string,
  mutation: UserSecurityMutation,
  additionalData: Prisma.UserUpdateInput = {},
  sideEffects?: SecurityMutationSideEffects
) {
  return runSerializableTransaction(async tx => {
    await acquireAdvisoryLock(tx, LOCK_KEYS.USER_ADMIN_INVARIANT);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new Error('User not found.');

    const nextRole = mutation.role ?? target.role;
    const nextStatus = mutation.status ?? target.status;
    if (
      target.role === 'ADMIN' &&
      target.status === 'ACTIVE' &&
      (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE')
    ) {
      const otherActiveAdmins = await tx.user.count({
        where: { id: { not: userId }, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (otherActiveAdmins === 0) {
        throw new Error('Operation would leave the system with no active administrators.');
      }
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { ...additionalData, ...mutation },
    });
    await sideEffects?.(tx);
    return updated;
  });
}

export async function bulkUpdateUserSecurityState(
  userIds: string[],
  mutation: UserSecurityMutation,
  additionalData: Prisma.UserUpdateManyMutationInput = {},
  sideEffects?: SecurityMutationSideEffects
) {
  const ids = [...new Set(userIds)];
  return runSerializableTransaction(async tx => {
    await acquireAdvisoryLock(tx, LOCK_KEYS.USER_ADMIN_INVARIANT);
    const targets = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true, status: true },
    });
    const removesActiveAdmins = targets.filter(target => {
      const nextRole = mutation.role ?? target.role;
      const nextStatus = mutation.status ?? target.status;
      return (
        target.role === 'ADMIN' &&
        target.status === 'ACTIVE' &&
        (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE')
      );
    }).length;
    if (removesActiveAdmins > 0) {
      const totalActiveAdmins = await tx.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      });
      if (totalActiveAdmins - removesActiveAdmins < 1) {
        throw new Error('Operation would leave the system with no active administrators.');
      }
    }
    const updated = await tx.user.updateMany({
      where: { id: { in: ids } },
      data: { ...additionalData, ...mutation },
    });
    await sideEffects?.(tx);
    return updated;
  });
}
