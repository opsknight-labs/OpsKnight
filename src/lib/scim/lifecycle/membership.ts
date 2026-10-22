import type { Prisma } from '@prisma/client';
import { advanceUserSessionVersions } from '@/lib/users/admin-invariants';

/** Reconcile the union of directory grants; pre-existing/manual and promoted rows survive. */
export async function reconcileTeam(
  tx: Prisma.TransactionClient,
  teamId: string,
  retiringBindingIds: readonly string[] = []
) {
  const bindings = await tx.scimGroupTeamBinding.findMany({
    where: { teamId },
    orderBy: { id: 'asc' },
    include: { group: { include: { memberships: true } }, grants: true },
  });
  const retiring = new Set(retiringBindingIds);
  const desired = new Map<string, string>();
  for (const binding of bindings)
    if (!retiring.has(binding.id))
      for (const member of binding.group.memberships) desired.set(member.userId, binding.id);
  const current = await tx.teamMember.findMany({ where: { teamId } });
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
        // Local role promotions establish manual authority; preferences never do.
        if (member?.role === 'MEMBER') {
          removedMembers.push(member.id);
          removedUserIds.push(member.userId);
          changedUserIds.add(member.userId);
        }
      }
    }
  const additions = [...desired.keys()].filter(userId => !existingUsers.has(userId));
  additions.forEach(userId => changedUserIds.add(userId));
  // Lock User before Team, matching local administration. Session and grant writes commit together.
  await advanceUserSessionVersions(tx, [...changedUserIds]);
  for (const transfer of transfers.values())
    await tx.scimTeamGrant.updateMany({
      where: { bindingId: transfer.from, userId: { in: transfer.users } },
      data: { bindingId: transfer.to },
    });
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
  if (additions.length) {
    await tx.teamMember.createMany({
      data: additions.map(userId => ({ teamId, userId, role: 'MEMBER' })),
    });
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
  return { changedUserIds: [...changedUserIds], revokedMemberships, transferredGrants };
}
