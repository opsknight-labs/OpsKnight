import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import MobileTeamsClient from '@/components/mobile/MobileTeamsClient';

export const dynamic = 'force-dynamic';

export default async function MobileTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q || '';

  const teams = await prisma.team.findMany({
    where: query
      ? {
          name: { contains: query, mode: 'insensitive' },
        }
      : undefined,
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          members: true,
          incidents: {
            where: { status: { in: activeIncidentStatuses() } },
          },
        },
      },
    },
  });

  return <MobileTeamsClient initialTeams={teams} query={query} />;
}
