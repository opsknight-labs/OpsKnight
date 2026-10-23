import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
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
    include: { group: { include: { memberships: true } }, grants: true },
  });
  const current = await tx.teamMember.findMany({
    where: { teamId },
    orderBy: { id: 'asc' },
    include: { scimGrant: true },
  });
  const bindings = stored.map(binding => ({
    id: binding.id,
    groupId: binding.groupId,
    connectorId: binding.group.connectorId,
    users: binding.group.memberships.map(member => member.userId).sort(),
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
        users: prospective.group.memberships.map(member => member.userId).sort(),
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
  // A stable group order makes prospective plans independent of a not-yet-created binding ID.
  for (const binding of [...bindings].sort((a, b) => a.groupId.localeCompare(b.groupId)))
    if (!retiring.has(binding.id))
      for (const userId of binding.users) desired.set(userId, binding.id);
  // Retain a grant's current source while that source still desires the member.
  for (const binding of bindings)
    if (!retiring.has(binding.id)) {
      const users = new Set(binding.users);
      for (const grant of binding.grants)
        if (users.has(grant.userId)) desired.set(grant.userId, binding.id);
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
