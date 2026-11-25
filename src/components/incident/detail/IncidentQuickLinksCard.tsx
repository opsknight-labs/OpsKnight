'use client';

import React from 'react';
import Link from 'next/link';
import { Server, ShieldAlert, BarChart2, Users, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncidentQuickLinksCardProps = {
  incidentPolicy?: { id: string; name: string } | null;
  noEscalation?: boolean;
  pinnedPolicy?: boolean;
  service: {
    id: string;
    name: string;
    status: string;
    slaTier?: string | null;
    policy?: {
      id: string;
      name: string;
    } | null;
  };
  team?: {
    id: string;
    name: string;
  } | null;
  className?: string;
  routePrefix?: string;
  /** For the Details panel, which already links the service and incident policy: the rest as one line. */
  embedded?: boolean;
};

function LinkRow({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-10 items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/40"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </Link>
  );
}

export default function IncidentQuickLinksCard({
  incidentPolicy,
  noEscalation,
  pinnedPolicy,
  service,
  team,
  className,
  routePrefix = '',
  embedded = false,
}: IncidentQuickLinksCardProps) {
  if (embedded) {
    const link =
      'text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline [&>svg]:ml-0.5 [&>svg]:inline';
    return (
      <div className="grid min-h-10 min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">Links</span>
        <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
          {service.policy && (
            <Link href={`${routePrefix}/policies/${service.policy.id}`} className={link}>
              Service default: {service.policy.name}
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
          {noEscalation && (
            <span className="text-xs text-muted-foreground">No personal escalation</span>
          )}
          <Link href={`/insights?service=${encodeURIComponent(service.id)}`} className={link}>
            Analytics
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
          {team && (
            <Link href={`${routePrefix}/teams/${team.id}`} className={link}>
              {team.name}
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs',
        className
      )}
    >
      <h2 className="border-b border-border/70 bg-muted/20 px-3 py-2 text-xs font-semibold text-foreground">
        Quick links
      </h2>

      <div className="flex flex-col divide-y divide-border/50">
        <LinkRow
          href={`${routePrefix}/services/${service.id}`}
          icon={Server}
          title={service.name}
          subtitle={`Service Catalog · ${service.slaTier || 'Standard Tier'}`}
        />

        {incidentPolicy && (
          <LinkRow
            href={`${routePrefix}/policies/${incidentPolicy.id}`}
            icon={ShieldAlert}
            title={incidentPolicy.name}
            subtitle={`Incident policy${pinnedPolicy ? ' · Pinned route' : ' · Service routing'}`}
          />
        )}

        {noEscalation && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No personal escalation policy selected.
          </p>
        )}
        {service.policy && (
          <Link
            className="block px-3 py-2 text-xs text-muted-foreground underline-offset-2 transition-colors hover:bg-muted/40 hover:text-foreground hover:underline"
            href={`${routePrefix}/policies/${service.policy.id}`}
          >
            Current service default: {service.policy.name}
          </Link>
        )}

        <LinkRow
          href={`/insights?service=${encodeURIComponent(service.id)}`}
          icon={BarChart2}
          title="Service analytics"
          subtitle="MTTR & Frequency Metrics"
        />

        {team && (
          <LinkRow
            href={`${routePrefix}/teams/${team.id}`}
            icon={Users}
            title={team.name}
            subtitle="Team Members & Schedule"
          />
        )}
      </div>
    </div>
  );
}
