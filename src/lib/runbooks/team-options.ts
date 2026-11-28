import prisma from '@/lib/prisma';

/** Every team, for owner pickers and library filters: a cap would hide the teams past it. */
export function listRunbookTeamOptions() {
  return prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}
