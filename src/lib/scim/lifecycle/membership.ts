import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { advanceUserSessionVersions } from '@/lib/users/admin-invariants';

type ProspectiveGroup = Prisma.ScimGroupGetPayload<{ include: { memberships: true } }>;
/** Read-only plan used by administrator approval and transactional execution. */
export async function planTeamReconciliation(
  tx: Prisma.TransactionClient,
  teamId: string,
  retiringBindingIds: readonly string[] = [],
  prospective?: { group: ProspectiveGroup; adoptMemberIds: string[] },
  includeRevision = true,
  affectedUserIds?: readonly string[]
) {
  const stored = await tx.scimGroupTeamBinding.findMany({
    where: { teamId },
    orderBy: { id: 'asc' },
    include: {
      group: true,
      grants: affectedUserIds ? { where: { userId: { in: [...affectedUserIds] } } } : true,
    },
  });
  const current = await tx.teamMember.findMany({
    where: { teamId, ...(affectedUserIds ? { userId: { in: [...affectedUserIds] } } : {}) },
    orderBy: { id: 'asc' },
    include: { scimGrant: true },
  });
  // Collapse overlapping directory sources in PostgreSQL rather than returning
  // groups × members to Node. Revisions still fingerprint every contributing row.
  const fingerprints = includeRevision
    ? await tx.$queryRaw<{ id: string; digest: string }[]>`
    SELECT b.id, encode(sha256(convert_to(coalesce(string_agg(m."userId", ',' ORDER BY m."userId"), ''), 'UTF8')), 'hex') AS digest
    FROM "ScimGroupTeamBinding" b
    LEFT JOIN "ScimGroupMembership" m ON m."groupId"=b."groupId"
    WHERE b."teamId"=${teamId} GROUP BY b.id ORDER BY b.id`
    : [];
  const prospectiveBinding =
    prospective && stored.find(item => item.groupId === prospective.group.id);
  // Only fixed SQL fragments are composed here. Every identifier/value from the
  // request is bound separately; no user text is interpolated into SQL. Avoid
  // nested Prisma.sql objects, whose class identity can differ in Next bundles.
  const memberScope = affectedUserIds
    ? 'WHERE m."userId" IN (SELECT jsonb_array_elements_text($4::jsonb))'
    : '';
  const grantScope = affectedUserIds
    ? 'AND g."userId" IN (SELECT jsonb_array_elements_text($4::jsonb))'
    : '';
  const values: unknown[] = [
    teamId,
    JSON.stringify(retiringBindingIds),
    prospective && !prospectiveBinding ? prospective.group.id : null,
  ];
  if (affectedUserIds) values.push(JSON.stringify(affectedUserIds));
  const desiredRows = await tx.$queryRawUnsafe<{ bindingId: string; userId: string }[]>(
    `
    WITH sources AS MATERIALIZED (
      SELECT b.id AS "bindingId", b."groupId" FROM "ScimGroupTeamBinding" b
      WHERE b."teamId"=$1 AND b.id NOT IN (SELECT jsonb_array_elements_text($2::jsonb))
      UNION ALL SELECT 'pending-binding', $3::text WHERE $3::text IS NOT NULL
    ), current_grants AS MATERIALIZED (
      SELECT g."userId", g."bindingId" FROM "ScimTeamGrant" g
      JOIN "ScimGroupTeamBinding" b ON b.id=g."bindingId"
      WHERE b."teamId"=$1 ${grantScope}
    ), preferred AS (
      SELECT m."userId", max(s."groupId") AS "groupId",
        max(s."bindingId") FILTER (WHERE s."bindingId"=g."bindingId") AS retained
      FROM sources s JOIN "ScimGroupMembership" m ON m."groupId"=s."groupId"
      LEFT JOIN current_grants g ON g."userId"=m."userId"
      ${memberScope}
      GROUP BY m."userId"
    ) SELECT p."userId", coalesce(p.retained, fallback."bindingId") AS "bindingId"
      FROM preferred p JOIN sources fallback ON fallback."groupId"=p."groupId"`,
    ...values
  );
  const bindings = stored.map(binding => ({
    id: binding.id,
    groupId: binding.groupId,
    connectorId: binding.group.connectorId,
    digest: fingerprints.find(item => item.id === binding.id)?.digest,
    grants: binding.grants
      .map(grant => ({ ...grant }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
  }));
  const snapshot = includeRevision
    ? JSON.stringify({
        bindings,
        current: current.map(member => ({
          id: member.id,
          userId: member.userId,
          role: member.role,
          grant: member.scimGrant,
        })),
        retiring: [...retiringBindingIds].sort(),
        prospective: prospective && {
          groupId: prospective.group.id,
          users: prospective.group.memberships.map(member => member.userId).sort(),
          adopted: [...prospective.adoptMemberIds].sort(),
        },
      })
    : '';
  if (prospective) {
    let binding = bindings.find(item => item.groupId === prospective.group.id);
    if (!binding) {
      binding = {
        id: 'pending-binding',
        groupId: prospective.group.id,
        connectorId: prospective.group.connectorId,
        digest: undefined,
        grants: [],
      };
      bindings.push(binding);
    }
    const adopted = new Set(prospective.adoptMemberIds);
    for (const member of current)
      if (adopted.has(member.id))
        binding.grants.push({
          bindingId: binding.id,
          userId: member.userId,
          teamMemberId: member.id,
        });
  }
  const retiring = new Set(retiringBindingIds);
  const desired = new Map<string, string>();
  for (const row of desiredRows) desired.set(row.userId, row.bindingId);
  // Explicit legacy adoption establishes provenance for a newly bound source.
  if (prospective && !retiring.has(prospectiveBinding?.id ?? 'pending-binding')) {
    const members = new Set(prospective.group.memberships.map(member => member.userId));
    const adopted = new Set(prospective.adoptMemberIds);
    for (const member of current)
      if (adopted.has(member.id) && members.has(member.userId))
        desired.set(member.userId, prospectiveBinding?.id ?? 'pending-binding');
  }
  const byId = new Map(current.map(member => [member.id, member]));
  const existingUsers = new Set(current.map(member => member.userId));
  const obsoleteGrantMembers: string[] = [];
  const removedMembers: string[] = [];
  const changedUserIds = new Set<string>();
  const removedUserIds: string[] = [];
  const transfers = new Map<string, { from: string; to: string; users: string[] }>();
  let transferredGrants = 0;
  for (const binding of bindings)
    for (const grant of binding.grants) {
      const member = byId.get(grant.teamMemberId);
      const desiredBinding = desired.get(grant.userId);
      if (desiredBinding && desiredBinding !== binding.id) {
        const key = `${binding.id}:${desiredBinding}`;
        const transfer = transfers.get(key) ?? { from: binding.id, to: desiredBinding, users: [] };
        transfer.users.push(grant.userId);
        transfers.set(key, transfer);
        transferredGrants++;
      }
      if (!desiredBinding) {
        obsoleteGrantMembers.push(grant.teamMemberId);
        if (member?.role === 'MEMBER') {
          removedMembers.push(member.id);
          removedUserIds.push(member.userId);
          changedUserIds.add(member.userId);
        }
      }
    }
  const additions = [...desired.keys()].filter(userId => !existingUsers.has(userId));
  additions.forEach(userId => changedUserIds.add(userId));
  return {
    current,
    desired,
    obsoleteGrantMembers,
    removedMembers,
    removedUserIds,
    changedUserIds: [...changedUserIds],
    transfers: [...transfers.values()],
    transferredGrants,
    additions,
    protectedOwners: current.filter(member => member.role === 'OWNER').length,
    revision: createHash('sha256').update(snapshot).digest('hex'),
  };
}

/** Reconcile directory grants while preserving manual memberships and promoted roles. */
export async function reconcileTeam(
  tx: Prisma.TransactionClient,
  teamId: string,
  retiringBindingIds: readonly string[] = [],
  affectedUserIds?: readonly string[]
) {
  if (affectedUserIds?.length === 0)
    return {
      changedUserIds: [],
      revokedMemberships: 0,
      transferredGrants: 0,
      addedMemberships: 0,
      protectedOwners: 0,
    };
  const plan = await planTeamReconciliation(
    tx,
    teamId,
    retiringBindingIds,
    undefined,
    false,
    affectedUserIds
  );
  const {
    changedUserIds,
    transfers,
    removedMembers,
    removedUserIds,
    obsoleteGrantMembers,
    additions,
    desired,
  } = plan;
  // Lock User before Team, matching local administration. Session and grant writes commit together.
  await advanceUserSessionVersions(tx, changedUserIds);
  let transferredGrants = 0;
  for (const transfer of transfers)
    transferredGrants += (
      await tx.scimTeamGrant.updateMany({
        where: { bindingId: transfer.from, userId: { in: transfer.users } },
        data: { bindingId: transfer.to },
      })
    ).count;
  const revokedMemberships = removedMembers.length
    ? (await tx.teamMember.deleteMany({ where: { id: { in: removedMembers }, role: 'MEMBER' } }))
        .count
    : 0;
  if (removedUserIds.length)
    await tx.team.updateMany({
      where: { id: teamId, teamLeadId: { in: removedUserIds } },
      data: { teamLeadId: null },
    });
  if (obsoleteGrantMembers.length)
    await tx.scimTeamGrant.deleteMany({ where: { teamMemberId: { in: obsoleteGrantMembers } } });
  let addedMemberships = 0;
  if (additions.length) {
    addedMemberships = (
      await tx.teamMember.createMany({
        data: additions.map(userId => ({ teamId, userId, role: 'MEMBER' })),
      })
    ).count;
    const inserted = await tx.teamMember.findMany({
      where: { teamId, userId: { in: additions } },
      select: { id: true, userId: true },
    });
    await tx.scimTeamGrant.createMany({
      data: inserted.map(member => ({
        teamMemberId: member.id,
        userId: member.userId,
        bindingId: desired.get(member.userId)!,
      })),
    });
  }
  return {
    changedUserIds,
    revokedMemberships,
    transferredGrants,
    addedMemberships,
    protectedOwners: plan.protectedOwners,
  };
}
