import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { advanceUserSessionVersions } from '@/lib/users/admin-invariants';

type ProspectiveGroup = Prisma.ScimGroupGetPayload<{ include: { memberships: true } }>;
/** Read-only plan used by administrator approval and transactional execution. */
export async function planTeamReconciliation(
  tx: Prisma.TransactionClient,
  teamId: string,
  retiringBindingIds: readonly string[] = [],
  prospective?: { group: ProspectiveGroup; adoptMemberIds: string[] }
) {
  const stored = await tx.scimGroupTeamBinding.findMany({
    where: { teamId },
    orderBy: { id: 'asc' },
    include: { group: true, grants: true },
  });
  const current = await tx.teamMember.findMany({
    where: { teamId },
    orderBy: { id: 'asc' },
    include: { scimGrant: true },
  });
  // Collapse overlapping directory sources in PostgreSQL rather than returning
  // groups × members to Node. Revisions still fingerprint every contributing row.
  const fingerprints = await tx.$queryRaw<{ id: string; digest: string }[]>`
    SELECT b.id, encode(sha256(convert_to(coalesce(string_agg(m."userId", ',' ORDER BY m."userId"), ''), 'UTF8')), 'hex') AS digest
    FROM "ScimGroupTeamBinding" b
    LEFT JOIN "ScimGroupMembership" m ON m."groupId"=b."groupId"
    WHERE b."teamId"=${teamId} GROUP BY b.id ORDER BY b.id`;
  const prospectiveBinding =
    prospective && stored.find(item => item.groupId === prospective.group.id);
  const retirement = retiringBindingIds.length
    ? Prisma.sql`AND b.id NOT IN (${Prisma.join([...retiringBindingIds])})`
    : Prisma.empty;
  const prospectiveRows =
    prospective && !prospectiveBinding
      ? Prisma.sql`UNION ALL SELECT 'pending-binding', m."groupId", m."userId"
        FROM "ScimGroupMembership" m WHERE m."groupId"=${prospective.group.id}`
      : Prisma.empty;
  const desiredRows = await tx.$queryRaw<{ bindingId: string; userId: string }[]>`
    WITH candidates AS (
      SELECT b.id AS "bindingId", b."groupId", m."userId"
      FROM "ScimGroupTeamBinding" b JOIN "ScimGroupMembership" m ON m."groupId"=b."groupId"
      WHERE b."teamId"=${teamId} ${retirement} ${prospectiveRows}
    ) SELECT DISTINCT ON (c."userId") c."bindingId", c."userId"
      FROM candidates c
      LEFT JOIN "TeamMember" tm ON tm."teamId"=${teamId} AND tm."userId"=c."userId"
      LEFT JOIN "ScimTeamGrant" g ON g."teamMemberId"=tm.id
      ORDER BY c."userId", (g."bindingId"=c."bindingId") DESC NULLS LAST, c."groupId" DESC`;
  const bindings = stored.map(binding => ({
    id: binding.id,
    groupId: binding.groupId,
    connectorId: binding.group.connectorId,
    digest: fingerprints.find(item => item.id === binding.id)?.digest,
    grants: binding.grants
      .map(grant => ({ ...grant }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
  }));
  const snapshot = JSON.stringify({
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
  });
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
  retiringBindingIds: readonly string[] = []
) {
  const plan = await planTeamReconciliation(tx, teamId, retiringBindingIds);
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
