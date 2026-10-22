import type { Prisma } from '@prisma/client';

/** Reconcile the union of directory grants; pre-existing/manual and promoted rows survive. */
export async function reconcileTeam(tx: Prisma.TransactionClient, teamId: string) {
  const bindings = await tx.scimGroupTeamBinding.findMany({
    where: { teamId },
    orderBy: { id: 'asc' },
    include: { group: { include: { memberships: true } }, grants: true },
  });
  const desired = new Map<string, string>();
  for (const binding of bindings)
    for (const member of binding.group.memberships) desired.set(member.userId, binding.id);
  const current = await tx.teamMember.findMany({ where: { teamId } });
  const byId = new Map(current.map(member => [member.id, member]));
  for (const binding of bindings)
    for (const grant of binding.grants) {
      const member = byId.get(grant.teamMemberId);
      const desiredBinding = desired.get(grant.userId);
      if (desiredBinding && desiredBinding !== binding.id)
        await tx.scimTeamGrant.update({
          where: { bindingId_userId: { bindingId: binding.id, userId: grant.userId } },
          data: { bindingId: desiredBinding },
        });
      if (!desiredBinding) {
        // A subsequent local promotion or preference change is an independent manual grant.
        if (member?.role === 'MEMBER' && member.receiveTeamNotifications)
          await tx.teamMember.deleteMany({
            where: { id: member.id, role: 'MEMBER', receiveTeamNotifications: true },
          });
        await tx.scimTeamGrant.deleteMany({
          where: { bindingId: binding.id, userId: grant.userId },
        });
      }
    }
  const existingUsers = new Set(current.map(m => m.userId));
  for (const [userId, bindingId] of desired)
    if (!existingUsers.has(userId)) {
      const member = await tx.teamMember.create({ data: { teamId, userId, role: 'MEMBER' } });
      await tx.scimTeamGrant.create({ data: { bindingId, userId, teamMemberId: member.id } });
    }
}
