import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import MobileCard from '@/components/mobile/MobileCard';
import MobileTime from '@/components/mobile/MobileTime';
import type { ReactNode } from 'react';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { buildIncidentListHref } from '@/lib/incident-links';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileServiceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const actor = await getCurrentAuthorizationActor();
  const incidentAccess = incidentReadWhere(actor);

  const service = await prisma.service.findFirst({
    where: { AND: [serviceReadWhere(actor), { id }] },
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

  if (!service) {
    notFound();
  }

  const isHealthy = service._count.incidents === 0;

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Back Button */}
      <Link
        href="/m/services"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Services
      </Link>

      {/* Service Header */}
      <MobileCard className="relative overflow-hidden">
        <div
          className={`absolute inset-x-0 top-0 h-1 ${isHealthy ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-red-500 to-rose-500'}`}
        />
        <div className="flex items-start gap-3">
          {/* Health Indicator */}
          <div
            className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full ${isHealthy ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}
          />

          <div className="flex-1">
            <h1 className="text-lg font-bold text-[color:var(--text-primary)]">{service.name}</h1>
            {service.description && (
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">{service.description}</p>
            )}
            <div
              className={`mt-3 inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold ${isHealthy ? 'bg-[color:var(--badge-success-bg)] text-[color:var(--badge-success-text)]' : 'bg-[color:var(--badge-error-bg)] text-[color:var(--badge-error-text)]'}`}
            >
              {isHealthy
                ? '✓ Operational'
                : `⚠ ${service._count.incidents} Active Incident${service._count.incidents !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
      </MobileCard>

      {/* Quick Actions */}
      <Link
        href={`/m/incidents/create?serviceId=${service.id}`}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        New Incident
      </Link>

      {/* Service Info */}
      <MobileCard>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          Details
        </h3>
        <DetailRow label="Escalation Policy" value={service.policy?.name || 'None'} />
        <DetailRow label="Created" value={<MobileTime value={service.createdAt} format="date" />} />
      </MobileCard>

      {/* Active Incidents */}
      {service.incidents.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
              Active Incidents
            </h2>
            <Link
              href={buildIncidentListHref({
                basePath: '/m/incidents',
                filter: 'all_open',
                serviceId: service.id,
              })}
              className="text-xs font-semibold text-primary"
            >
              See all →
            </Link>
          </div>

          <div className="flex flex-col gap-3">
            {service.incidents.map(incident => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className="flex flex-col gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 shadow-sm transition hover:bg-[color:var(--bg-secondary)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-[color:var(--bg-secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--text-muted)]">
                    {incident.status}
                  </span>
                  {incident.urgency && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        incident.urgency === 'HIGH'
                          ? 'bg-[color:var(--badge-error-bg)] text-[color:var(--badge-error-text)]'
                          : incident.urgency === 'MEDIUM'
                            ? 'bg-[color:var(--badge-warning-bg)] text-[color:var(--badge-warning-text)]'
                            : 'bg-[color:var(--badge-success-bg)] text-[color:var(--badge-success-text)]'
                      }`}
                    >
                      {incident.urgency}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                  {incident.title}
                </div>
                <div className="text-[11px] text-[color:var(--text-muted)]">
                  <MobileTime value={incident.createdAt} format="relative-short" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2 text-xs">
      <span className="text-[color:var(--text-muted)]">{label}</span>
      <span className="font-semibold text-[color:var(--text-primary)]">{value}</span>
    </div>
  );
}
