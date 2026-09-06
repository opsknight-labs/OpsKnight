'use client';

import Link from 'next/link';
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Wrench,
  ArrowRight,
  Activity,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

type ServiceHealthData = {
  id: string;
  name: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE' | 'MAINTENANCE';
  activeIncidents: number;
  criticalIncidents: number;
};

type DashboardServiceHealthProps = {
  services: ServiceHealthData[];
};

export default function DashboardServiceHealth({ services }: DashboardServiceHealthProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'OPERATIONAL':
        return {
          bg: 'bg-green-50',
          text: 'text-green-700',
          border: 'border-green-200',
          dotBg: 'bg-green-500',
          icon: <CheckCircle className="h-4 w-4" />,
          label: 'Operational',
        };
      case 'DEGRADED':
        return {
          bg: 'bg-amber-50',
          text: 'text-amber-700',
          border: 'border-amber-200',
          dotBg: 'bg-amber-500',
          icon: <AlertTriangle className="h-4 w-4" />,
          label: 'Degraded',
        };
      case 'PARTIAL_OUTAGE':
        return {
          bg: 'bg-orange-50',
          text: 'text-orange-700',
          border: 'border-orange-200',
          dotBg: 'bg-orange-500',
          icon: <AlertCircle className="h-4 w-4" />,
          label: 'Partial Outage',
        };
      case 'MAJOR_OUTAGE':
        return {
          bg: 'bg-red-50',
          text: 'text-red-700',
          border: 'border-red-200',
          dotBg: 'bg-red-500',
          icon: <XCircle className="h-4 w-4" />,
          label: 'Major Outage',
        };
      case 'MAINTENANCE':
        return {
          bg: 'bg-indigo-50',
          text: 'text-indigo-700',
          border: 'border-indigo-200',
          dotBg: 'bg-indigo-500',
          icon: <Wrench className="h-4 w-4" />,
          label: 'Maintenance',
        };
      default:
        return {
          bg: 'bg-neutral-50',
          text: 'text-neutral-700',
          border: 'border-neutral-200',
          dotBg: 'bg-neutral-500',
          icon: <Activity className="h-4 w-4" />,
          label: 'Unknown',
        };
    }
  };

  const statusCounts = services.reduce(
    (acc, service) => {
      acc[service.status] = (acc[service.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const sortedServices = [...services].sort((a, b) => {
    const statusOrder = [
      'MAJOR_OUTAGE',
      'PARTIAL_OUTAGE',
      'DEGRADED',
      'MAINTENANCE',
      'OPERATIONAL',
    ];
    const aIndex = statusOrder.indexOf(a.status);
    const bIndex = statusOrder.indexOf(b.status);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return b.activeIncidents - a.activeIncidents;
  });

  return (
    <div className="p-0">
      {/* Header with View All */}
      <div className="flex justify-between items-center mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-foreground">Service Health Overview</h3>
            <Badge variant="neutral" size="sm">
              {services.length}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Active incident counts exclude snoozed and suppressed incidents.
          </div>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-2 text-primary font-semibold hover:bg-primary/10"
        >
          <Link href="/services">
            View All <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* Status Summary Cards */}
      {Object.entries(statusCounts).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
          {Object.entries(statusCounts).map(([status, count]) => {
            const config = getStatusConfig(status);
            return (
              <div
                key={status}
                className={cn(
                  'px-3 py-2.5 rounded-lg border-2 transition-all duration-200',
                  'hover:shadow-sm hover:-translate-y-0.5',
                  config.bg,
                  config.border
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={cn('w-2 h-2 rounded-full', config.dotBg)} />
                  <span className={cn('text-xs font-bold uppercase tracking-wide', config.text)}>
                    {config.label}
                  </span>
                </div>
                <div className={cn('text-2xl font-bold', config.text)}>{count}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Services List */}
      <div className="space-y-2.5">
        {sortedServices.length === 0 ? (
          <div className="py-12 px-6 text-center bg-gradient-to-b from-neutral-50/50 to-card rounded-lg border border-border">
            <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center">
              <Activity className="h-7 w-7 text-neutral-400" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">No Services Found</p>
            <p className="text-xs text-muted-foreground">
              Services will appear here once they are added
            </p>
          </div>
        ) : (
          sortedServices.slice(0, 5).map(service => {
            const config = getStatusConfig(service.status);
            return (
              <Link
                key={service.id}
                href={`/services/${service.id}`}
                className={cn(
                  'flex items-center justify-between p-4 rounded-lg',
                  'bg-gradient-to-r from-white to-neutral-50/50',
                  'border-2 transition-all duration-200',
                  'hover:shadow-lg hover:scale-[1.02] no-underline group',
                  config.border
                )}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Status Indicator */}
                  <div
                    className={cn(
                      'w-3 h-3 rounded-full shrink-0 ring-2 ring-white shadow-sm',
                      config.dotBg
                    )}
                  />

                  {/* Service Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground mb-1 truncate group-hover:text-primary transition-colors">
                      {service.name}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {config.icon}
                      <span className={cn('text-xs font-semibold', config.text)}>
                        {config.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Incident Badges */}
                {service.activeIncidents > 0 && (
                  <div className="flex items-center gap-2 ml-2">
                    {service.criticalIncidents > 0 && (
                      <Badge variant="danger" size="xs">
                        {service.criticalIncidents} Critical
                      </Badge>
                    )}
                    <Badge variant="neutral" size="xs">
                      {service.activeIncidents} Active
                    </Badge>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>

      {/* Show More Link */}
      {sortedServices.length > 5 && (
        <div className="mt-4 text-center">
          <Button asChild variant="outline" size="sm" className="gap-2 font-semibold">
            <Link href="/services">
              <TrendingUp className="h-3.5 w-3.5" />
              View {sortedServices.length - 5} More Services
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
