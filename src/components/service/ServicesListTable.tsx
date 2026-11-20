'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
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
  Server,
  Network,
  Plug,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/service/Pagination';
import ServiceIntelligenceBadges, {
  type ServiceIntelligenceBadgeData,
} from '@/components/service/ServiceIntelligenceBadges';
import { ServicesSortSelect, useServicesParams } from '@/components/service/ServicesFilters';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  toneClasses,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
  type DirectorySort,
} from '@/components/patterns';

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
  /** Optional intelligence badges; absent when there is nothing to show or the viewer may not see them. */
  intelligenceBadges?: ServiceIntelligenceBadgeData;
  maintenanceTitle?: string | null;
  team?: { id: string; name: string } | null;
  policy?: { id: string; name: string } | null;
  _count?: { incidents: number };
};

type ServicesListTableProps = {
  services: ServiceListItem[];
  canManageServices: boolean;
  currentSort?: string;
  emptyState?: { title: string; description: string };
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
};

const statusAccentClass: Record<string, string> = {
  OPERATIONAL: toneClasses('ok').borderLeft,
  DEGRADED: toneClasses('elevated').borderLeft,
  CRITICAL: toneClasses('critical').borderLeft,
};

function ServiceStatusBadge({ status }: { status: string }) {
  if (status === 'OPERATIONAL') {
    return (
      <Badge variant="success" size="sm" className="gap-1 pl-1 pr-2">
        <CheckCircle2 className="h-3 w-3 fill-emerald-500 text-white" aria-hidden="true" />
        Operational
      </Badge>
    );
  }
  if (status === 'DEGRADED') {
    return (
      <Badge variant="warning" size="sm" className="gap-1 pl-1 pr-2">
        <AlertTriangle className="h-3 w-3 fill-yellow-500 text-white" aria-hidden="true" />
        Degraded
      </Badge>
    );
  }
  if (status === 'CRITICAL') {
    return (
      <Badge variant="danger" size="sm" className="gap-1 pl-1 pr-2">
        <XCircle className="h-3 w-3 fill-red-500 text-white" aria-hidden="true" />
        Critical
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" size="sm">
      Unknown
    </Badge>
  );
}

function StatusCell({ service }: { service: ServiceListItem }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <ServiceIntelligenceBadges
        serviceId={service.id}
        // One "In maintenance" chip per row: the service's own window wins over a noise-control window.
        badges={
          service.maintenanceTitle && service.intelligenceBadges
            ? { ...service.intelligenceBadges, maintenance: undefined }
            : service.intelligenceBadges
        }
      />
      <ServiceStatusBadge status={service.dynamicStatus} />
      {service.maintenanceTitle && (
        <Badge variant="info" size="xs" title={service.maintenanceTitle}>
          In maintenance
        </Badge>
      )}
    </span>
  );
}

/** Active incident count; amber when open, red when any is high urgency. */
function OpenIncidents({ service, long = false }: { service: ServiceListItem; long?: boolean }) {
  if (service.metricDataState === 'unavailable') {
    return (
      <span className={cn('font-semibold', toneClasses('elevated').text)}>
        {long ? 'Metrics unavailable' : <span title="Metrics unavailable">—</span>}
      </span>
    );
  }
  const count = service.openIncidentCount;
  if (count === 0) {
    return (
      <span className={cn('tabular-nums', long ? toneClasses('ok').text : 'text-muted-foreground')}>
        {long ? 'No active incidents' : 0}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        toneClasses(service.hasCritical ? 'critical' : 'elevated').text
      )}
      title={service.hasCritical ? 'Includes high-urgency incidents' : undefined}
    >
      {long ? `${count} active ${count === 1 ? 'incident' : 'incidents'}` : count}
    </span>
  );
}

function PolicyLink({ policy }: { policy?: ServiceListItem['policy'] }) {
  if (!policy) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/policies/${policy.id}`} className="relative z-10 truncate hover:underline">
      {policy.name}
    </Link>
  );
}

function ServiceActions({ service }: { service: ServiceListItem }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={`Actions for ${service.name}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/services/${service.id}`} className="flex cursor-pointer items-center gap-2">
            <Eye aria-hidden="true" />
            View Details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href={`/services/${service.id}/settings`}
            className="flex cursor-pointer items-center gap-2"
          >
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const muted = (value: string | null | undefined) =>
  value ? (
    <span className="truncate">{value}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const columns: DirectoryColumn<ServiceListItem>[] = [
  {
    id: 'service',
    header: 'Service',
    sortKey: 'name',
    className: 'max-w-0 w-[30%]',
    cell: s => (
      <DirectoryPrimaryCell
        href={`/services/${s.id}`}
        title={s.name}
        subtitle={s.description || 'No description provided.'}
      />
    ),
  },
  { id: 'status', header: 'Status', hideable: true, cell: s => <StatusCell service={s} /> },
  {
    id: 'team',
    header: 'Team',
    hideable: true,
    className: 'hidden md:table-cell',
    cell: s => muted(s.team?.name),
  },
  {
    id: 'incidents',
    header: 'Open incidents',
    sortKey: 'incidents',
    hideable: true,
    className: 'whitespace-nowrap text-right',
    cell: s => <OpenIncidents service={s} />,
  },
  {
    id: 'policy',
    header: 'Escalation policy',
    hideable: true,
    className: 'hidden lg:table-cell',
    cell: s => <PolicyLink policy={s.policy} />,
  },
  {
    id: 'sla',
    header: 'SLA tier',
    hideable: true,
    className: 'hidden whitespace-nowrap xl:table-cell',
    cell: s => muted(s.slaTier),
  },
  {
    id: 'region',
    header: 'Region',
    hideable: true,
    className: 'hidden xl:table-cell',
    cell: s => muted(s.region),
  },
];

function mobileRow(s: ServiceListItem) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link
          href={`/services/${s.id}`}
          className="truncate font-medium text-foreground hover:underline"
        >
          {s.name}
        </Link>
        <StatusCell service={s} />
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {s.team && <span className="truncate">{s.team.name}</span>}
        {s.team && <span aria-hidden="true">·</span>}
        <span className="shrink-0">
          <OpenIncidents service={s} long />
        </span>
      </div>
    </div>
  );
}

function ServiceCard({
  service,
  canManageServices,
}: {
  service: ServiceListItem;
  canManageServices: boolean;
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border border-l-4 border-border bg-card p-3 transition-colors duration-150 hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring',
        statusAccentClass[service.dynamicStatus] ?? 'border-l-border'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {/* Stretched link: the whole card opens the service. */}
          <Link
            href={`/services/${service.id}`}
            className="block truncate text-sm font-semibold text-foreground after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:outline-none"
          >
            {service.name}
          </Link>
          <StatusCell service={service} />
        </div>
        {canManageServices && (
          <div className="relative z-10 -mr-1 -mt-1">
            <ServiceActions service={service} />
          </div>
        )}
      </div>
      <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">
        {service.description || 'No description provided.'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {service.team && (
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {service.team.name}
          </span>
        )}
        {service.region && (
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" aria-hidden="true" />
            {service.region}
          </span>
        )}
        {service.slaTier && (
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" aria-hidden="true" />
            {service.slaTier}
          </span>
        )}
        {service.policy && (
          <span className="flex min-w-0 items-center gap-1">
            <Network className="h-3 w-3 shrink-0" aria-hidden="true" />
            <PolicyLink policy={service.policy} />
          </span>
        )}
        <OpenIncidents service={service} long />
      </div>
    </div>
  );
}

const GUIDE_STEPS = [
  {
    title: 'Create a service',
    description: 'Name it, pick the owning team and set its service tier.',
  },
  {
    title: 'Connect alert sources',
    description:
      'Add an integration on the service’s Integrations tab. Alerts sent to it open incidents on the service.',
  },
  {
    title: 'Attach an escalation policy',
    description: 'Incidents on the service page responders through its escalation policy.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'Escalation Policies',
    href: '/policies',
    icon: <Network className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Integrations',
    href: '/settings/integrations',
    icon: <Plug className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Team Directory',
    href: '/teams',
    icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

export default function ServicesListTable({
  services,
  canManageServices,
  currentSort,
  pagination,
  emptyState,
}: ServicesListTableProps) {
  const [view, setView] = useDirectoryView('services');
  const columnVisibility = useDirectoryColumns('services', columns);
  const { updateParams } = useServicesParams();
  // The URL sort is `<key>_<direction>` (e.g. incidents_desc); "status" has no column.
  const [sortKey, sortDirection] = (currentSort ?? 'name_asc').split('_');
  const sort: DirectorySort | null =
    sortDirection === 'asc' || sortDirection === 'desc'
      ? { key: sortKey, direction: sortDirection }
      : null;

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
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <DirectoryHeader
        title="Service directory"
        summary={`Showing ${showingFrom}–${showingTo} of ${totalItems}`}
        sort={<ServicesSortSelect currentSort={currentSort} />}
        columns={columnVisibility}
        density
        view={{ value: view, onChange: setView }}
        guide={<DirectoryGuide title="How services work" steps={GUIDE_STEPS} links={GUIDE_LINKS} />}
      />

      {services.some(service => service.metricDataState === 'unavailable') && (
        <div
          className={cn('border-b px-4 py-2 text-sm', toneClasses('elevated').soft)}
          role="alert"
        >
          Live service incident statistics are unavailable. Zero counts are hidden until metrics
          recover.
        </div>
      )}

      {services.length === 0 ? (
        <EmptyState
          icon={<Server className="h-6 w-6 text-muted-foreground" />}
          title={emptyState?.title ?? 'No services found'}
          description={
            emptyState?.description ??
            'Try adjusting your search query or filters to find services.'
          }
          size="md"
        />
      ) : view === 'table' ? (
        <DirectoryTable
          rows={services}
          getRowId={s => s.id}
          columns={columns}
          label="Services"
          hiddenColumns={columnVisibility.hidden}
          sort={sort}
          onSortChange={next => updateParams({ sort: `${next.key}_${next.direction}` })}
          rowActions={canManageServices ? s => <ServiceActions service={s} /> : undefined}
          mobileRow={mobileRow}
        />
      ) : (
        <DirectoryCardGrid>
          {services.map(service => (
            <ServiceCard key={service.id} service={service} canManageServices={canManageServices} />
          ))}
        </DirectoryCardGrid>
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
  );
}
