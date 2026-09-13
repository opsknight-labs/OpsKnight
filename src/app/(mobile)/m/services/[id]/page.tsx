import type { ReactNode } from 'react';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowRight, Plus, Server } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import MobileTime from '@/components/mobile/MobileTime';
import {
  IncidentStatusBadge,
  IncidentUrgencyBadge,
} from '@/components/incident/IncidentSemanticBadge';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { buildIncidentListHref } from '@/lib/incident-links';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileServiceDetailPage({ params }: PageProps) {
  const context = await getRequestActorContext();
  if (!context) redirect('/login?callbackUrl=/m/services');

  const { id } = await params;
  const incidentAccess = incidentReadWhere(context.actor);
  const service = await prisma.service.findFirst({
    where: { AND: [serviceReadWhere(context.actor), { id }] },
    include: {
      policy: true,
      incidents: {
        where: {
          AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          urgency: true,
          createdAt: true,
        },
      },
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

  if (!service) notFound();
  const isOperational = service._count.incidents === 0;

  return (
    <div className="responsive-page space-y-4 pb-12">
      <Link
        href="/m/services"
        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
        <span>Back to services</span>
      </Link>

      <section className="rounded-xl border border-border bg-card p-3.5 text-card-foreground">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isOperational
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300'
            }`}
          >
            <Server className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-base font-bold text-foreground">
                {service.name}
              </h1>
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  isOperational
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                }`}
              >
                {isOperational ? 'Operational' : 'Impacted'}
              </span>
            </div>
            {service.description && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {service.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-[11px]">
          <Detail label="Active incidents" value={service._count.incidents} />
          <Detail label="Escalation policy" value={service.policy?.name || 'None'} />
        </div>
      </section>

      <Button asChild className="h-11 w-full rounded-xl">
        <Link href={`/m/incidents/create?serviceId=${service.id}`}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          New incident
        </Link>
      </Button>

      {service.incidents.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-0.5">
            <h2 className="text-sm font-bold text-foreground">Active incidents</h2>
            <Link
              href={buildIncidentListHref({
                basePath: '/m/incidents',
                filter: 'all_open',
                serviceId: service.id,
              })}
              className="inline-flex min-h-10 items-center text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
            {service.incidents.map((incident, index) => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className={`block min-w-0 px-3.5 py-3 transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <IncidentStatusBadge status={incident.status} />
                  <IncidentUrgencyBadge urgency={incident.urgency} />
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    <MobileTime value={incident.createdAt} format="relative-short" />
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">
                  {incident.title}
                </p>
              </Link>
            ))}
          </Card>
        </section>
      ) : (
        <div className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-[11px] text-muted-foreground">
          No active incidents for this service.
        </div>
      )}

      <Card className="rounded-xl border-border bg-card p-3.5 shadow-none">
        <h2 className="text-xs font-semibold text-foreground">Service details</h2>
        <div className="mt-2 divide-y divide-border/70">
          <DetailRow label="Escalation policy" value={service.policy?.name || 'None'} />
          <DetailRow
            label="Created"
            value={<MobileTime value={service.createdAt} format="date" />}
          />
        </div>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-muted-foreground">{label}</span>
      <span className="mt-0.5 block truncate font-semibold text-foreground">{value}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 py-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}
