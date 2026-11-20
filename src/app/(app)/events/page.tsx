import prisma from '@/lib/prisma';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserTimeZone } from '@/lib/timezone';
import { Button } from '@/components/ui/shadcn/button';
import { PageHeader } from '@/components/patterns';
import { Activity, FlaskConical } from 'lucide-react';
import { assertAdmin } from '@/lib/rbac';

import EventsListTable from '@/components/events/EventsListTable';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type EventLogsPageProps = {
  searchParams?: Promise<{
    page?: string;
    search?: string;
    service?: string;
  }>;
};

export default async function EventLogsPage({ searchParams }: EventLogsPageProps) {
  await requirePageAccess('/events');
  await assertAdmin();
  const params = await searchParams;
  const requestedPage = parsePageParam(params?.page);
  const pageSize = 50;
  const search = params?.search?.trim().slice(0, 200) || undefined;
  const service = params?.service?.trim().slice(0, 200) || undefined;
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { timeZone: true } })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);

  const filters: Prisma.IncidentEventWhereInput[] = [];
  if (service) {
    filters.push({ incident: { service: { name: service } } });
  }
  if (search) {
    filters.push({
      OR: [
        { message: { contains: search, mode: 'insensitive' } },
        { incidentId: { contains: search, mode: 'insensitive' } },
        { incident: { title: { contains: search, mode: 'insensitive' } } },
        { incident: { service: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    });
  }
  const where: Prisma.IncidentEventWhereInput = filters.length > 0 ? { AND: filters } : {};

  const [totalEvents, services] = await Promise.all([
    prisma.incidentEvent.count({ where }),
    prisma.service.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
  ]);

  const pagination = calculatePaginationBounds({
    totalItems: totalEvents,
    page: requestedPage,
    pageSize,
  });
  const page = pagination.page;

  const events = await prisma.incidentEvent.findMany({
    where,
    include: {
      incident: {
        select: {
          id: true,
          title: true,
          service: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Audit & Telemetry"
        title="Event Logs"
        icon={Activity}
        description="Every incident lifecycle event across services: triggers, acknowledgements, escalations and resolutions."
        primaryAction={
          <Button asChild size="sm" className="gap-2">
            <Link href="/events/test">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
              Send a test event
            </Link>
          </Button>
        }
        stats={[
          {
            label: search || service ? 'Matching events' : 'Events',
            value: totalEvents.toLocaleString(),
            icon: <Activity className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <EventsListTable
        initialEvents={events}
        userTimeZone={userTimeZone}
        currentSearch={search}
        currentService={service}
        serviceNames={services.map(item => item.name)}
        page={page}
        totalCount={totalEvents}
        pageSize={pageSize}
      />
    </div>
  );
}
