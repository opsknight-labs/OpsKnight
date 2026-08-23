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

  return (
    <main className="p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Event Logs</h1>
          <p className="text-muted-foreground">Incident lifecycle events and audit trail</p>
        </div>
      </div>

      {/* Event Log Table */}
      <Card className="bg-white overflow-hidden">
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
                <TableRow key={event.id} className="border-b border-slate-100">
                  <TableCell className="p-4 font-mono text-xs text-muted-foreground">
                    {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                  </TableCell>
                  <TableCell className="p-4">
                    <Link
                      href={`/incidents/${event.incident.id}`}
                      className="text-primary font-medium hover:underline"
                    >
                      #{event.incident.id.slice(-5).toUpperCase()}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-1">{event.incident.title}</div>
                  </TableCell>
                  <TableCell className="p-4 text-sm">{event.incident.service.name}</TableCell>
                  <TableCell className="p-4">
                    <div className="flex items-start gap-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                      <span className="text-sm text-foreground">{event.message}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="p-8 text-center text-muted-foreground">
                    No events logged yet. Events will appear here when incidents are triggered,
                    acknowledged, or resolved.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </main>
  );
}
