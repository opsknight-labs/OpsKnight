import 'server-only';

import { createHash } from 'node:crypto';
import type { Prisma, Role, RoleSource } from '@prisma/client';
import { bulkUpdateUserSecurityState } from '@/lib/users/admin-invariants';

// A fixed, visible precedence keeps overlapping group memberships deterministic.
const precedence: readonly Role[] = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'];
type RoleState = { role: Role; roleSource: RoleSource; scimRoleMappingAdopted: boolean };
export function resolveScimRole(roles: readonly Role[], current: RoleState): RoleState {
  const role = precedence.find(candidate => roles.includes(candidate));
  if (role) return { role, roleSource: 'SCIM', scimRoleMappingAdopted: true };
  // Historical SCIM provenance alone grants no authority to the new mapping feature.
  return current.roleSource === 'SCIM' && current.scimRoleMappingAdopted
    ? { role: 'USER', roleSource: 'SCIM', scimRoleMappingAdopted: true }
    : current;
}

/** Read every contributing group in the identity's own connection. */
export async function planScimRoles(
  tx: Prisma.TransactionClient,
  connectorId: string,
  userIds: readonly string[],
  override?: { groupId: string; role: Role | null }
) {
  if (!userIds.length) return { changes: [], revision: '' };
  // unnest() of a text[] gives PostgreSQL the selection's real size; a jsonb set is
  // estimated at 100 rows and, right after bulk provisioning (stale statistics), took
  // 6-8 s for 10,000 ids and expired the 10 s serializable save transaction.
  const users = await tx.$queryRaw<(RoleState & { id: string; tokenVersion: number })[]>`
    SELECT u.id, u.role::text AS role, u."roleSource"::text AS "roleSource",
      u."tokenVersion", u."scimRoleMappingAdopted"
    FROM unnest(${[...new Set(userIds)]}::text[]) AS selected("userId")
    JOIN "ScimIdentity" i ON i."userId" = selected."userId"
    JOIN "User" u ON u.id = i."userId"
    WHERE i."connectorId" = ${connectorId}
    ORDER BY i."userId"`;
  const identities = users.map(user => ({ user }));
  // Collapse overlapping groups in PostgreSQL: return at most one row and four
  // distinct roles per user, rather than groups × members in application memory.
  const contributions = identities.length
    ? await tx.$queryRaw<
        {
          userId: string;
          roles: Role[];
          revision: string;
        }[]
      >`
    WITH selected_users AS MATERIALIZED (
      SELECT "userId" FROM unnest(${identities.map(identity => identity.user.id)}::text[]) AS selected("userId")
    ), selected_memberships AS MATERIALIZED (
      SELECT m."userId", m."groupId" FROM "ScimGroupMembership" m
      WHERE m."userId" IN (SELECT "userId" FROM selected_users)
    ), grants AS (
      SELECT m."userId", g.id AS "groupId", g."systemRole"::text AS "storedRole",
        (CASE WHEN g.id = ${override?.groupId ?? null}
          THEN ${override?.role ?? null}::"Role" ELSE g."systemRole" END)::text AS "effectiveRole"
      FROM selected_memberships m JOIN "ScimGroup" g ON g.id = m."groupId"
      WHERE g."connectorId" = ${connectorId}
        AND (g."systemRole" IS NOT NULL OR g.id = ${override?.groupId ?? null})
    )
    SELECT "userId", coalesce(
      array_agg(DISTINCT "effectiveRole" ORDER BY "effectiveRole") FILTER (WHERE "effectiveRole" IS NOT NULL),
      ARRAY[]::text[]) AS roles,
      encode(sha256(convert_to(string_agg("groupId" || ':' || coalesce("storedRole", ''), ',' ORDER BY "groupId"), 'UTF8')), 'hex') AS revision
    FROM grants GROUP BY "userId" ORDER BY "userId"`
    : [];
  const grants = new Map(contributions.map(row => [row.userId, row.roles]));
  const changes = identities.flatMap(({ user }) => {
    const next = resolveScimRole(grants.get(user.id) ?? [], user);
    return next.role === user.role &&
      next.roleSource === user.roleSource &&
      next.scimRoleMappingAdopted === user.scimRoleMappingAdopted
      ? []
      : [
          {
            userId: user.id,
            from: user.role,
            fromSource: user.roleSource,
            fromAdopted: user.scimRoleMappingAdopted,
            ...next,
          },
        ];
  });
  const revision = createHash('sha256')
    .update(JSON.stringify({ identities, contributions, override }))
    .digest('hex');
  return { changes, revision };
}

export function summarizeScimRoleChanges(
  changes: Awaited<ReturnType<typeof planScimRoles>>['changes']
) {
  return {
    changedUsers: changes.length,
    adoptedUsers: changes.filter(change => !change.fromAdopted || change.fromSource !== 'SCIM')
      .length,
    demotions: changes.filter(change => change.from === 'ADMIN' && change.role !== 'ADMIN').length,
  };
}

/** Commit roles, adoption, session revocation and audit in one serializable transaction. */
export async function reconcileScimRoles(
  tx: Prisma.TransactionClient,
  connectorId: string,
  userIds: readonly string[],
  requestId: string,
  actorId?: string
) {
  const { changes } = await planScimRoles(tx, connectorId, userIds);
  // Promotions first permit a safe administrator handover. Reuse shared last-admin
  // and MCP protection; callers invalidate projections only after commit.
  for (const role of precedence) {
    const ids = changes.filter(change => change.role === role).map(change => change.userId);
    if (!ids.length) continue;
    await bulkUpdateUserSecurityState(
      ids,
      { role, roleSource: 'SCIM', tokenVersion: { increment: 1 } },
      { scimRoleMappingAdopted: true },
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
          fromAdopted: change.fromAdopted,
          scimRoleMappingAdopted: true,
          ...(actorId ? { actorId } : {}),
        },
      })),
    });
  }
  return changes.map(change => change.userId);
}
