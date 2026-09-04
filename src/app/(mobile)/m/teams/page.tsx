import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import MobileTeamsClient from '@/components/mobile/MobileTeamsClient';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { incidentReadWhere, teamReadWhere } from '@/lib/authorization-filters';

export const dynamic = 'force-dynamic';

export default async function MobileTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q || '';
  const actor = await getCurrentAuthorizationActor();
  const incidentAccess = incidentReadWhere(actor);
  const selectedWhere = query
    ? { name: { contains: query, mode: 'insensitive' as const } }
    : {};

  const teams = await prisma.team.findMany({
    where: { AND: [teamReadWhere(actor), selectedWhere] },
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
