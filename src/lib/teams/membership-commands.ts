import 'server-only';

import prisma from '@/lib/prisma';

export async function removeTeamMembership(memberId: string) {
  return prisma.$transaction(
    async tx => {
      const member = await tx.teamMember.findUnique({
        where: { id: memberId },
        include: { team: { select: { name: true } } },
      });
      if (!member) throw new Error('Member not found.');

      if (member.role === 'OWNER') {
        const otherActiveOwners = await tx.teamMember.count({
          where: {
            teamId: member.teamId,
            role: 'OWNER',
            NOT: { id: member.id },
            user: { status: 'ACTIVE' },
          },
        });
        if (otherActiveOwners === 0) {
          throw new Error('Each team must retain at least one active owner.');
        }
      }

      await tx.teamMember.delete({ where: { id: member.id } });
      await tx.team.updateMany({
        where: { id: member.teamId, teamLeadId: member.userId },
        data: { teamLeadId: null },
      });
      await tx.user.update({
        where: { id: member.userId },
        data: { tokenVersion: { increment: 1 } },
      });
      return member;
    },
    { isolationLevel: 'Serializable' }
  );
}
