import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { acquireAdvisoryLock, LOCK_KEYS } from '@/lib/db-locks';
import { runSerializableTransaction } from '@/lib/db-utils';
import { logAudit } from '@/lib/audit';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { revokeAllRegisteredSessions } from '@/lib/session-registry';
import { updateUserSecurityState } from './admin-invariants';

export const userAdministrationInput = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('set-role'),
      role: z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']),
    })
    .strict(),
  z.object({ operation: z.literal('deactivate') }).strict(),
  z.object({ operation: z.literal('reactivate') }).strict(),
  z.object({ operation: z.literal('revoke-sessions') }).strict(),
]);
export type UserAdministrationActor = { id: string; apiKey?: { id: string } };
const userIdInput = z.string().cuid();
export const userAdministrationSelect = {
  id: true,
  name: true,
  role: true,
  roleSource: true,
  status: true,
  revision: true,
  deactivatedAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/** Re-read authority inside the mutation/replay transaction; a credential never freezes an admin role. */
export async function requireUserAdministrator(
  tx: Prisma.TransactionClient,
  actor: UserAdministrationActor
) {
  const principal = await tx.user.findUnique({
    where: { id: actor.id },
    select: { role: true, status: true },
  });
  if (principal?.role !== 'ADMIN' || principal.status !== 'ACTIVE')
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Active administrator access is required.',
    });
}

/** Canonical UI/REST security command. The caller owns cache eviction when joining a transaction. */
export async function administerUser(
  userId: string,
  rawInput: z.input<typeof userAdministrationInput>,
  actor: UserAdministrationActor,
  options: { client?: Prisma.TransactionClient; expectedRevision?: number } = {}
) {
  userIdInput.parse(userId);
  const input = userAdministrationInput.parse(rawInput);
  const command = async (tx: Prisma.TransactionClient) => {
    await acquireAdvisoryLock(tx, LOCK_KEYS.USER_ADMIN_INVARIANT);
    await requireUserAdministrator(tx, actor);
    if (userId === actor.id && (input.operation === 'deactivate' || input.operation === 'set-role'))
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Administrators cannot deactivate themselves or change their own role.',
      });
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { ...userAdministrationSelect, passwordHash: true },
    });
    if (!target) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
    if (options.expectedRevision !== undefined && target.revision !== options.expectedRevision)
      throw preconditionFailed();
    if (
      (input.operation === 'set-role' &&
        target.role === input.role &&
        target.roleSource === 'MANUAL') ||
      (input.operation === 'deactivate' && target.status === 'DISABLED')
    )
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: userAdministrationSelect });
    if (input.operation === 'reactivate' && target.status !== 'DISABLED')
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Only disabled users can be reactivated.',
      });
    const mutation =
      input.operation === 'set-role'
        ? { role: input.role, roleSource: 'MANUAL' as const }
        : input.operation === 'deactivate'
          ? { status: 'DISABLED' as const }
          : input.operation === 'reactivate'
            ? { status: target.passwordHash ? ('ACTIVE' as const) : ('INVITED' as const) }
            : {};
    const additionalData: Prisma.UserUpdateInput = {
      tokenVersion: { increment: 1 },
      ...(input.operation === 'deactivate'
        ? { deactivatedAt: new Date(), invitationGeneration: { increment: 1 } }
        : {}),
      ...(input.operation === 'reactivate' ? { deactivatedAt: null } : {}),
    };
    await updateUserSecurityState(
      userId,
      mutation,
      additionalData,
      async client => {
        if (input.operation === 'revoke-sessions')
          await revokeAllRegisteredSessions(userId, client);
        if (input.operation === 'deactivate') {
          const revokedAt = new Date();
          await client.userToken.updateMany({
            where: { userId, usedAt: null, revokedAt: null },
            data: { revokedAt },
          });
          await client.apiKey.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt },
          });
          await client.oidcLinkingApproval.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt },
          });
          await client.userDevice.deleteMany({ where: { userId } });
        }
        await logAudit(
          {
            action:
              input.operation === 'set-role'
                ? 'user.role.updated'
                : input.operation === 'deactivate'
                  ? 'user.deactivated'
                  : input.operation === 'reactivate'
                    ? 'user.reactivated'
                    : 'user.sessions.revoked',
            entityType: 'USER',
            entityId: userId,
            actorId: actor.id,
            source: actor.apiKey ? 'API' : 'UI',
            details: {
              ...(input.operation === 'set-role' ? { role: input.role } : {}),
              ...(actor.apiKey ? { apiClientId: actor.apiKey.id } : {}),
            },
          },
          client
        );
      },
      undefined,
      undefined,
      tx
    );
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select: userAdministrationSelect });
  };
  if (options.client) return command(options.client);
  const result = await runSerializableTransaction(command);
  invalidateSessionSecurityProjection(userId);
  return result;
}
