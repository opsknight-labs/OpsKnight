import 'server-only';

import { createHash } from 'node:crypto';
import type { Prisma, Role, RoleSource } from '@prisma/client';
import { bulkUpdateUserSecurityState } from '@/lib/users/admin-invariants';

// A fixed, visible precedence keeps overlapping group memberships deterministic.
const precedence: readonly Role[] = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'];
export function resolveScimRole(
  roles: readonly Role[],
  current: { role: Role; roleSource: RoleSource }
): { role: Role; roleSource: RoleSource } {
  const role = precedence.find(candidate => roles.includes(candidate));
  if (role) return { role, roleSource: 'SCIM' };
  return current.roleSource === 'SCIM' ? { role: 'USER', roleSource: 'SCIM' } : current;
}

/** Read all contributing groups in the identity's own connection, including competing rules. */
export async function planScimRoles(
  tx: Prisma.TransactionClient,
  connectorId: string,
  userIds: readonly string[],
  override?: { groupId: string; role: Role | null }
) {
  if (!userIds.length) return { changes: [], revision: '' };
  const identities = await tx.scimIdentity.findMany({
    where: { connectorId, userId: { in: [...new Set(userIds)] } },
    select: { user: { select: { id: true, role: true, roleSource: true, tokenVersion: true } } },
    orderBy: { userId: 'asc' },
  });
  const memberships = await tx.scimGroupMembership.findMany({
    where: {
      userId: { in: identities.map(identity => identity.user.id) },
      group: {
        connectorId,
        OR: [{ systemRole: { not: null } }, ...(override ? [{ id: override.groupId }] : [])],
      },
    },
    select: { userId: true, group: { select: { id: true, systemRole: true } } },
    orderBy: [{ userId: 'asc' }, { groupId: 'asc' }],
  });
  const grants = new Map<string, Role[]>();
  for (const membership of memberships) {
    const roles = grants.get(membership.userId) ?? [];
    const role =
      membership.group.id === override?.groupId ? override.role : membership.group.systemRole;
    if (role) roles.push(role);
    grants.set(membership.userId, roles);
  }
  const changes = identities.flatMap(({ user }) => {
    const next = resolveScimRole(grants.get(user.id) ?? [], user);
    return next.role === user.role && next.roleSource === user.roleSource
      ? []
      : [{ userId: user.id, from: user.role, fromSource: user.roleSource, ...next }];
  });
  const revision = createHash('sha256')
    .update(JSON.stringify({ identities, memberships, override }))
    .digest('hex');
  return { changes, revision };
}

/** Commit roles, session revocation and audit in the caller's serializable transaction. */
export async function reconcileScimRoles(
  tx: Prisma.TransactionClient,
  connectorId: string,
  userIds: readonly string[],
  requestId: string,
  actorId?: string
) {
  const { changes } = await planScimRoles(tx, connectorId, userIds);
  // Four bounded writes, with promotions first for administrator handover. Reuse the
  // shared last-admin/MCP invariant, and invalidate projections only after commit.
  for (const role of precedence) {
    const ids = changes.filter(change => change.role === role).map(change => change.userId);
    if (!ids.length) continue;
    await bulkUpdateUserSecurityState(
      ids,
      { role, roleSource: 'SCIM', tokenVersion: { increment: 1 } },
      {},
      undefined,
      tx
    );
  }
  for (let offset = 0; offset < changes.length; offset += 1000) {
    await tx.scimEvent.createMany({
      data: changes.slice(offset, offset + 1000).map(change => ({
        connectorId,
        action: 'user.role.synced',
        resourceId: change.userId,
        requestId,
        details: {
          fromRole: change.from,
          fromSource: change.fromSource,
          role: change.role,
          roleSource: change.roleSource,
          ...(actorId ? { actorId } : {}),
        },
      })),
    });
  }
  return changes.map(change => change.userId);
}
