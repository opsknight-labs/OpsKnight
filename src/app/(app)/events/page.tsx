import prisma from '@/lib/prisma';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Card } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import { Activity, Sparkles, Layers, Clock } from 'lucide-react';
import { assertAdmin } from '@/lib/rbac';

import EventsListTable from '@/components/events/EventsListTable';

export const dynamic = 'force-dynamic';

export default async function EventLogsPage() {
  await assertAdmin();
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { timeZone: true } })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);

  const events = await prisma.incidentEvent.findMany({
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
    take: 200,
  });

  const totalEvents = events.length;
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
            label: 'Retained Events',
            value: totalEvents,
            icon: <Activity className="h-3.5 w-3.5" />,
          },
          {
            label: 'Incidents Touched',
            value: uniqueIncidents,
            icon: <Layers className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: uniqueIncidents > 0 ? 'text-rose-200' : undefined,
          },
          {
            label: 'Services Active',
            value: uniqueServices,
            icon: <Layers className="h-3.5 w-3.5 text-blue-200" />,
            valueClassName: uniqueServices > 0 ? 'text-blue-200' : undefined,
          },
          {
            label: 'Window',
            value: 'Recent 200',
            icon: <Clock className="h-3.5 w-3.5 text-amber-200" />,
          },
        ]}
      />

      {/* Events List Table with Search, Filter & CSV Export */}
      <EventsListTable initialEvents={events} userTimeZone={userTimeZone} />
    </main>
  );
}
