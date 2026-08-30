'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  Server,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

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
  team?: { id: string; name: string } | null;
  _count?: { incidents: number };
};

import Pagination from './Pagination';

type ServicesListTableProps = {
  services: ServiceListItem[];
  canManageServices: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
};

const statusAccentClass: Record<string, string> = {
  OPERATIONAL: 'border-l-emerald-500',
  DEGRADED: 'border-l-yellow-500',
  CRITICAL: 'border-l-red-500',
  UNKNOWN: 'border-l-slate-300',
};

function ServiceStatusBadge({ status }: { status: string }) {
  if (status === 'OPERATIONAL') {
    return (
      <Badge variant="success" size="sm" className="gap-1 pl-1 pr-2">
        <CheckCircle2 className="h-3 w-3 fill-emerald-500 text-white" />
        Operational
      </Badge>
    );
  }
  if (status === 'DEGRADED') {
    return (
      <Badge variant="warning" size="sm" className="gap-1 pl-1 pr-2">
        <AlertTriangle className="h-3 w-3 fill-yellow-500 text-white" />
        Degraded
      </Badge>
    );
  }
  if (status === 'CRITICAL') {
    return (
      <Badge variant="danger" size="sm" className="gap-1 pl-1 pr-2">
        <XCircle className="h-3 w-3 fill-red-500 text-white" />
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

export default function ServicesListTable({
  services,
  canManageServices,
  pagination,
}: ServicesListTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

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
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-5 py-3.5 bg-white border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
        <div className="min-w-[220px]">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-extrabold">
            Service directory
          </div>
          <div className="text-sm text-slate-600 mt-0.5">
            Showing{' '}
            <span className="font-semibold text-slate-900">
              {showingFrom}-{showingTo}
            </span>{' '}
            of <span className="font-semibold text-slate-900">{totalItems}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Active incident counts exclude snoozed and suppressed incidents.
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 md:p-4 lg:p-5 bg-white">
        {services.some(service => service.metricDataState === 'unavailable') && (
          <div
            className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="alert"
          >
            Live service incident statistics are unavailable. Zero counts are hidden until metrics
            recover.
          </div>
        )}
        {services.length === 0 ? (
          <EmptyState
            icon={<Server className="h-6 w-6 text-muted-foreground" />}
            title="No services found"
            description="Try adjusting your search query or filters to find services."
            size="md"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {services.map(service => (
              <div
                key={service.id}
                className={cn(
                  'group relative rounded-2xl border bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-all',
                  'hover:shadow-md hover:-translate-y-[1px]',
                  'focus-within:ring-2 focus-within:ring-primary/20',
                  'border-slate-200',
                  statusAccentClass[service.dynamicStatus] ?? 'border-l-slate-300',
                  'border-l-4',
                  navigatingId === service.id && 'opacity-70 pointer-events-none'
                )}
                onClick={e => {
                  const target = e.target as HTMLElement;
                  if (target.closest('[data-no-row-nav="true"]')) return;
                  setNavigatingId(service.id);
                  startTransition(() => {
                    router.push(`/services/${service.id}`);
                  });
                }}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setNavigatingId(service.id);
                    startTransition(() => {
                      router.push(`/services/${service.id}`);
                    });
                  }
                }}
              >
                {/* Loading overlay */}
                {navigatingId === service.id && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px] rounded-2xl">
                    <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm font-medium text-primary">Opening...</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-4 items-start p-3 md:p-4">
                  {/* Icon/Avatar Placeholder if needed, or just status indicator */}

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        href={`/services/${service.id}`}
                        data-no-row-nav="true"
                        className="block font-extrabold text-slate-900 leading-tight truncate text-base hover:text-primary transition-colors"
                      >
                        {service.name}
                      </Link>

                      <div className="flex flex-wrap items-center gap-2">
                        <ServiceStatusBadge status={service.dynamicStatus} />
                      </div>
                    </div>

                    <p className="text-sm text-slate-500 line-clamp-1 max-w-3xl">
                      {service.description || 'No description provided.'}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium">
                        {service.team && (
                          <div className="flex items-center gap-1.5 text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                            <Users className="h-3 w-3" />
                            {service.team.name}
                          </div>
                        )}

                        {service.region && (
                          <div className="flex items-center gap-1.5">
                            <Globe className="h-3 w-3 opacity-70" />
                            {service.region}
                          </div>
                        )}

                        {service.slaTier && (
                          <div className="flex items-center gap-1.5">
                            <Shield className="h-3 w-3 opacity-70" />
                            {service.slaTier}
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 ml-1">
                          {service.metricDataState === 'unavailable' ? (
                            <span className="text-amber-700 font-semibold">
                              Metrics unavailable
                            </span>
                          ) : service.openIncidentCount > 0 ? (
                            <span className="text-red-600 font-semibold">
                              {service.openIncidentCount} active incidents
                            </span>
                          ) : (
                            <span className="text-emerald-600">No active incidents</span>
                          )}
                        </div>
                      </div>

                      <div data-no-row-nav="true" className="flex items-center gap-2">
                        {canManageServices && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200"
                                onClick={e => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/services/${service.id}`}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <Eye className="h-4 w-4 text-slate-500" />
                                  View Details
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/services/${service.id}/settings`}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <Settings className="h-4 w-4 text-slate-500" />
                                  Settings
                                </Link>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
