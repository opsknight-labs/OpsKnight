'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  MoreHorizontal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Settings,
  Globe,
  Shield,
  Users,
  Loader2,
  SearchX,
  Server,
  Wrench,
} from 'lucide-react';
import EmptyState from '@/components/patterns/EmptyState';
import { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import { toneClasses } from '@/components/patterns/status-tone';
import Pagination from '@/components/service/Pagination';

export type ServiceListItem = {
  id: string;
  name: string;
  description: string | null;
  region: string | null;
  slaTier: string | null;
  dynamicStatus: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL';
  openIncidentCount: number;
  hasCritical: boolean;
  incidentCount?: number;
  metricDataState?: 'available' | 'unavailable';
  maintenanceTitle?: string | null;
  team?: { id: string; name: string } | null;
  _count?: { incidents: number };
};

type ServicesListTableProps = {
  services: ServiceListItem[];
  canManageServices: boolean;
  emptyState?: { title: string; description: string };
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
};

const SERVICE_STATUS_META = {
  operational: { label: 'Operational', tone: 'ok', icon: CheckCircle2 },
  degraded: { label: 'Degraded', tone: 'elevated', icon: AlertTriangle },
  critical: { label: 'Critical', tone: 'critical', icon: XCircle },
} as const;

function serviceStatusMeta(status: string) {
  switch (status) {
    case 'OPERATIONAL':
      return SERVICE_STATUS_META.operational;
    case 'DEGRADED':
      return SERVICE_STATUS_META.degraded;
    case 'CRITICAL':
      return SERVICE_STATUS_META.critical;
    default:
      return null;
  }
}

function ServiceStatusBadge({ status }: { status: string }) {
  const meta = serviceStatusMeta(status);
  const Icon = meta?.icon;
  return (
    <span
      data-status={status.toLowerCase()}
      className={cn(BADGE_BASE_CLASS, badgeSizeClass('sm'), toneClasses(meta?.tone).soft)}
    >
      {Icon && <Icon className="shrink-0" strokeWidth={2.25} aria-hidden="true" />}
      <span>{meta?.label ?? 'Unknown'}</span>
    </span>
  );
}

export default function ServicesListTable({
  services,
  canManageServices,
  pagination,
  emptyState,
}: ServicesListTableProps) {
  const searchParams = useSearchParams();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const hasActiveFilters = [...searchParams.keys()].some(
    key => key !== 'page' && key !== 'error' && key !== 'sort'
  );

  const totalItems = pagination?.totalItems ?? services.length;
  const showingFrom =
    pagination && totalItems > 0
      ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1
      : totalItems > 0
        ? 1
        : 0;
  const showingTo = pagination
    ? Math.min(pagination.currentPage * pagination.itemsPerPage, totalItems)
    : services.length;

  return (
    <section
      aria-labelledby="service-directory-heading"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <div className="min-w-0">
          <h2 id="service-directory-heading" className="text-sm font-semibold text-foreground">
            Service directory
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            Showing{' '}
            <span className="font-medium text-foreground">
              {showingFrom}–{showingTo}
            </span>{' '}
            of <span className="font-medium text-foreground">{totalItems}</span>
          </p>
        </div>
      </div>

      <div className="p-3 md:p-4">
        {services.some(service => service.metricDataState === 'unavailable') && (
          <div
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            role="alert"
          >
            Live service incident statistics are unavailable. Zero counts are hidden until metrics
            recover.
          </div>
        )}
        {services.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon={<SearchX />}
              title="No services match these filters"
              description="Nothing in your scope matches the current search and filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/services">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Server />}
              title={emptyState?.title ?? 'No services yet'}
              description={
                emptyState?.description ??
                (canManageServices
                  ? 'A service is anything that can raise an incident: an API, a queue, a database. Use “New service” above to add the first one, then connect an integration.'
                  : 'Services appear here once an administrator or responder creates them.')
              }
            />
          )
        ) : (
          <ul className="flex flex-col gap-2" aria-labelledby="service-directory-heading">
            {services.map(service => (
              <li
                key={service.id}
                className={cn(
                  'group relative rounded-lg border border-border bg-card transition-colors duration-150 hover:border-ink-300 hover:bg-muted/40',
                  navigatingId === service.id && 'opacity-70'
                )}
              >
                {navigatingId === service.id && (
                  <div
                    role="status"
                    className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-card/70"
                  >
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                      Opening…
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4 md:px-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/services/${service.id}`}
                        onClick={e => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
                            return;
                          setNavigatingId(service.id);
                        }}
                        className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring md:text-base"
                      >
                        {service.name}
                      </Link>
                      <ServiceStatusBadge status={service.dynamicStatus} />
                      {service.maintenanceTitle && (
                        <span
                          title={service.maintenanceTitle}
                          className={cn(
                            BADGE_BASE_CLASS,
                            badgeSizeClass('xs'),
                            toneClasses('info').soft
                          )}
                        >
                          <Wrench className="shrink-0" aria-hidden="true" />
                          In maintenance
                        </span>
                      )}
                    </div>

                    <p className="line-clamp-1 max-w-3xl text-sm text-muted-foreground">
                      {service.description || 'No description provided.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {service.team && (
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {service.team.name}
                        </span>
                      )}
                      {service.region && (
                        <span className="inline-flex items-center gap-1.5">
                          <Globe className="h-3 w-3" aria-hidden="true" />
                          {service.region}
                        </span>
                      )}
                      {service.slaTier && (
                        <span className="inline-flex items-center gap-1.5">
                          <Shield className="h-3 w-3" aria-hidden="true" />
                          {service.slaTier}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="relative z-10 flex shrink-0 items-center gap-3 text-xs">
                    {service.metricDataState === 'unavailable' ? (
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        Metrics unavailable
                      </span>
                    ) : service.openIncidentCount > 0 ? (
                      <Link
                        href={`/incidents?serviceId=${service.id}&filter=all_open`}
                        className="rounded-sm font-semibold tabular-nums text-rose-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-rose-300"
                      >
                        {service.openIncidentCount} active{' '}
                        {service.openIncidentCount === 1 ? 'incident' : 'incidents'}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">No active incidents</span>
                    )}

                    {canManageServices && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8"
                            aria-label={`Actions for ${service.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/services/${service.id}`}
                              className="flex items-center gap-2"
                            >
                              <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
                              View details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/services/${service.id}/settings`}
                              className="flex items-center gap-2"
                            >
                              <Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
                              Settings
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {pagination && (
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            itemsPerPage={pagination.itemsPerPage}
            itemLabel="service"
          />
        )}
      </div>
    </section>
  );
}
