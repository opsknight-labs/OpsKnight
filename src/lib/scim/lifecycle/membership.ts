import type { Prisma } from '@prisma/client';

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
  const changedUserIds = new Set<string>();
  let revokedMemberships = 0;
  let transferredGrants = 0;
  const desired = new Map<string, string>();
  for (const binding of bindings)
    if (!retiring.has(binding.id))
      for (const member of binding.group.memberships) desired.set(member.userId, binding.id);
  const current = await tx.teamMember.findMany({ where: { teamId } });
  const byId = new Map(current.map(member => [member.id, member]));
  for (const binding of bindings)
    for (const grant of binding.grants) {
      const member = byId.get(grant.teamMemberId);
      const desiredBinding = desired.get(grant.userId);
      if (desiredBinding && desiredBinding !== binding.id) {
        await tx.scimTeamGrant.update({
          where: { bindingId_userId: { bindingId: binding.id, userId: grant.userId } },
          data: { bindingId: desiredBinding },
        });
        transferredGrants++;
      }
      if (!desiredBinding) {
        // Local role promotions establish manual authority; preferences never do.
        if (member?.role === 'MEMBER') {
          const removed = await tx.teamMember.deleteMany({
            where: { id: member.id, role: 'MEMBER' },
          });
          if (removed.count) {
            changedUserIds.add(member.userId);
            revokedMemberships += removed.count;
            await tx.team.updateMany({
              where: { id: teamId, teamLeadId: member.userId },
              data: { teamLeadId: null },
            });
          }
        }
        await tx.scimTeamGrant.deleteMany({
          where: { bindingId: binding.id, userId: grant.userId },
        });
      }
    }
  const existingUsers = new Set(current.map(m => m.userId));
  for (const [userId, bindingId] of desired)
    if (!existingUsers.has(userId)) {
      const member = await tx.teamMember.create({ data: { teamId, userId, role: 'MEMBER' } });
      changedUserIds.add(userId);
      await tx.scimTeamGrant.create({ data: { bindingId, userId, teamMemberId: member.id } });
    }
  if (changedUserIds.size)
    await tx.user.updateMany({
      where: { id: { in: [...changedUserIds] } },
      data: { tokenVersion: { increment: 1 } },
    });
  return { changedUserIds: [...changedUserIds], revokedMemberships, transferredGrants };
}
