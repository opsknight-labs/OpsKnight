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

      {/* Event Log Table */}
      <Card className="bg-white overflow-hidden shadow-sm">
        {events.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Activity className="h-6 w-6 text-muted-foreground/60" />}
              title="No events logged yet"
              description="Events will appear here in real-time when incidents are triggered, acknowledged, or resolved."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/events/test">Trigger test event</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <Table className="min-w-[700px]">
              <TableHeader className="bg-slate-50 border-b border-border">
                <TableRow>
                  <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                    Timestamp
                  </TableHead>
                  <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                    Incident
                  </TableHead>
                  <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                    Service
                  </TableHead>
                  <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                    Event
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map(event => (
                  <TableRow
                    key={event.id}
                    className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                  >
                    <TableCell className="p-4 font-mono text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                    </TableCell>
                    <TableCell className="p-4">
                      <Link
                        href={`/incidents/${event.incident.id}`}
                        className="text-primary font-semibold hover:underline"
                      >
                        #{event.incident.id.slice(-5).toUpperCase()}
                      </Link>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {event.incident.title}
                      </div>
                    </TableCell>
                    <TableCell className="p-4 text-sm font-medium">
                      {event.incident.service.name}
                    </TableCell>
                    <TableCell className="p-4">
                      <div className="flex items-start gap-2">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                        <span className="text-sm text-foreground">{event.message}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </main>
  );
}
