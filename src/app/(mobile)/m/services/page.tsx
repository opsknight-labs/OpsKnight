import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import MobileServicesClient from '@/components/mobile/MobileServicesClient';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';

export const dynamic = 'force-dynamic';

export default async function MobileServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q || '';
  const actor = await getCurrentAuthorizationActor();
  const incidentAccess = incidentReadWhere(actor);
  const serviceWhere = query
    ? { name: { contains: query, mode: 'insensitive' as const } }
    : {};

  const services = await prisma.service.findMany({
    where: { AND: [serviceReadWhere(actor), serviceWhere] },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          incidents: {
            where: {
              AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }],
            },
          },
        },
      },
    },
  });

  return <MobileServicesClient initialServices={services} query={query} />;
}
