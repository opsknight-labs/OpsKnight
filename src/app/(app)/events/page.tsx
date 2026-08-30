import prisma from '@/lib/prisma';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserTimeZone } from '@/lib/timezone';
import { Button } from '@/components/ui/shadcn/button';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Activity, Sparkles, Layers, Clock } from 'lucide-react';
import { assertAdmin } from '@/lib/rbac';

import EventsListTable from '@/components/events/EventsListTable';

export const dynamic = 'force-dynamic';

type EventLogsPageProps = {
  searchParams?: Promise<{
    page?: string;
    search?: string;
    service?: string;
  }>;
};

export default async function EventLogsPage({ searchParams }: EventLogsPageProps) {
  await assertAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params?.page || '1', 10) || 1);
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

  const [events, totalEvents, services] = await Promise.all([
    prisma.incidentEvent.findMany({
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
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.incidentEvent.count({ where }),
    prisma.service.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
  ]);

  const uniqueIncidents = new Set(events.map(e => e.incident.id)).size;
  const uniqueServices = new Set(events.map(e => e.incident.service.name)).size;
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        tag="Audit & Telemetry"
        title="Event Logs"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Activity className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Review real-time incident lifecycle events, alert state transitions, and responder audit
            trail across all services.
          </p>
        }
        statsPlacement="bottom"
        actions={
          <Button
            asChild
            className="gap-2 shadow-sm font-semibold bg-background text-foreground hover:bg-background/90"
          >
            <Link href="/events/test">
              <Sparkles className="h-4 w-4" />
              Ingestion Simulator
            </Link>
          </Button>
        }
        stats={[
          {
            label: 'Matching Events',
            value: totalEvents,
            icon: <Activity className="h-3.5 w-3.5" />,
          },
          {
            label: 'Incidents on Page',
            value: uniqueIncidents,
            icon: <Layers className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: uniqueIncidents > 0 ? 'text-rose-200' : undefined,
          },
          {
            label: 'Services on Page',
            value: uniqueServices,
            icon: <Layers className="h-3.5 w-3.5 text-blue-200" />,
            valueClassName: uniqueServices > 0 ? 'text-blue-200' : undefined,
          },
          {
            label: 'Page',
            value: `${page} of ${Math.max(1, Math.ceil(totalEvents / pageSize))}`,
            icon: <Clock className="h-3.5 w-3.5 text-amber-200" />,
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
    </main>
  );
}
