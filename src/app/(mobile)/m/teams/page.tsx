import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { activeIncidentStatuses } from '@/lib/incident-status';
import MobileTeamsClient from '@/components/mobile/MobileTeamsClient';
import { incidentReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

export default async function MobileTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m/teams');

  const params = await searchParams;
  const query = params.q?.trim() || '';
  const incidentAccess = incidentReadWhere(context.actor);
  const selectedWhere = query
    ? { name: { contains: query, mode: 'insensitive' as const } }
    : {};

  const teams = await prisma.team.findMany({
    where: { AND: [teamReadWhere(context.actor), selectedWhere] },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          members: true,
          incidents: {
            where: {
              AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }],
            },
          },
        },
      },
    },
  });

  return <MobileTeamsClient initialTeams={teams} query={query} />;
}
