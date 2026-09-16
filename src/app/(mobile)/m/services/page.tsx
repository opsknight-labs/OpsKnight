import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { activeIncidentStatuses } from '@/lib/incident-status';
import MobileServicesClient from '@/components/mobile/MobileServicesClient';
import { appRoutes } from '@/lib/app-routes';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

export default async function MobileServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/services'));

  const params = await searchParams;
  const query = params.q?.trim() || '';
  const incidentAccess = incidentReadWhere(context.actor);
  const serviceWhere = query
    ? { name: { contains: query, mode: 'insensitive' as const } }
    : {};

  const services = await prisma.service.findMany({
    where: { AND: [serviceReadWhere(context.actor), serviceWhere] },
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
