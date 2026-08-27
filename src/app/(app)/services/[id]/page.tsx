import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUserPermissions } from '@/lib/rbac';
import { deleteService } from '../actions';

// UI Components
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';

// Icons
import {
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Globe,
  Settings,
  Zap,
} from 'lucide-react';

// Custom Components
import IncidentList from '@/components/service/IncidentList';
import Pagination from '@/components/service/Pagination';
import DeleteServiceButton from '@/components/service/DeleteServiceButton';
import CreateIncidentButton from '@/components/incident/CreateIncidentButton';

const INCIDENTS_PER_PAGE = 20;

type ServiceDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ page?: string; tab?: string }>;
};

function StatusBadge({ status }: { status: string }) {
  if (status === 'OPERATIONAL') {
    return (
      <Badge variant="success" size="sm" className="gap-1 pl-1 pr-2">
        <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" />
        Operational
      </Badge>
    );
  }
  if (status === 'DEGRADED') {
    return (
      <Badge variant="warning" size="sm" className="gap-1 pl-1 pr-2">
        <AlertTriangle className="h-4 w-4 fill-yellow-500 text-white" />
        Degraded
      </Badge>
    );
  }
  if (status === 'CRITICAL') {
    return (
      <Badge variant="danger" size="sm" className="gap-1 pl-1 pr-2">
        <XCircle className="h-4 w-4 fill-red-500 text-white" />
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

async function ServiceMetricsSummary({ serviceId }: { serviceId: string }) {
  const { calculateSLAMetrics, calculateMultiServiceUptime } = await import('@/lib/sla-server');
  const slaWindowDays = 30;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - slaWindowDays * 24 * 60 * 60 * 1000);

  const [slaMetrics, uptimeByService] = await Promise.all([
    calculateSLAMetrics({
      serviceId,
      windowDays: slaWindowDays,
      includeActiveIncidents: true,
    }),
    calculateMultiServiceUptime([serviceId], thirtyDaysAgo, now),
  ]);

  const activeIncidentsCount = slaMetrics.activeIncidents;
  const windowTotalIncidents = slaMetrics.totalIncidents;
  const slaCompliance = slaMetrics.resolveCompliance;
  const mttr = slaMetrics.mttr ? slaMetrics.mttr / 60 : undefined; // Convert minutes to hours

  const effectiveDurationDays =
    (slaMetrics.effectiveEnd.getTime() - slaMetrics.effectiveStart.getTime()) /
    (1000 * 60 * 60 * 24);
  const incidentsPerMonth =
    effectiveDurationDays > 0 ? (windowTotalIncidents / effectiveDurationDays) * 30 : 0;

  const availability = Math.max(0, Math.min(100, uptimeByService[serviceId] ?? 100));

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mt-6">
      <Card className="bg-white/10 border-white/20 backdrop-blur">
        <CardContent className="p-3 md:p-4 text-center">
          <div className="text-xl md:text-2xl font-extrabold">{availability.toFixed(2)}%</div>
          <div className="text-[10px] md:text-xs opacity-90">Availability</div>
        </CardContent>
      </Card>
      <Card className="bg-white/10 border-white/20 backdrop-blur">
        <CardContent className="p-3 md:p-4 text-center">
          <div className="text-xl md:text-2xl font-extrabold">
            {mttr !== undefined
              ? mttr < 1
                ? `${Math.round(mttr * 60)}m`
                : mttr < 24
                  ? `${mttr.toFixed(1)}h`
                  : `${(mttr / 24).toFixed(1)}d`
              : '-'}
          </div>
          <div className="text-[10px] md:text-xs opacity-90">MTTR</div>
        </CardContent>
      </Card>
      <Card className="bg-white/10 border-white/20 backdrop-blur">
        <CardContent className="p-3 md:p-4 text-center">
          <div className="text-xl md:text-2xl font-extrabold">
            {incidentsPerMonth < 1 ? '<1' : incidentsPerMonth.toFixed(1)}
          </div>
          <div className="text-[10px] md:text-xs opacity-90">Incidents / month</div>
        </CardContent>
      </Card>
      <Card className="bg-white/10 border-white/20 backdrop-blur">
        <CardContent className="p-3 md:p-4 text-center">
          <div className="text-xl md:text-2xl font-extrabold">
            {slaCompliance !== null ? `${slaCompliance.toFixed(1)}%` : '-'}
          </div>
          <div className="text-[10px] md:text-xs opacity-90">SLA Compliance</div>
        </CardContent>
      </Card>
    </div>
  );
}

function ServiceMetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mt-6">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="bg-white/10 border-white/20 backdrop-blur">
          <CardContent className="p-3 md:p-4 text-center">
            <div className="mx-auto h-6 md:h-7 w-16 rounded bg-white/25 animate-pulse" />
            <div className="mx-auto mt-2 h-3 w-24 rounded bg-white/20 animate-pulse" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function ServiceDetailPage({ params, searchParams }: ServiceDetailPageProps) {
  const { id } = await params;
  const searchParamsResolved = await searchParams;
  const page = Math.max(1, parseInt(searchParamsResolved?.page || '1', 10));
  const tab = (searchParamsResolved?.tab as 'incidents' | 'history') || 'incidents';
  const skip = (page - 1) * INCIDENTS_PER_PAGE;

  // Define status filter based on active tab
  const incidentWhere =
    tab === 'incidents'
      ? { status: { in: activeIncidentStatuses() } }
      : { status: 'RESOLVED' as const };

  // Parallelize data fetching
  const { calculateSLAMetrics } = await import('@/lib/sla-server');
  const slaWindowDays = 30;

  const [serviceRaw, totalIncidentCount, slaMetrics] = await Promise.all([
    // 1. Service Data (with filtering for the list)
    prisma.service.findUnique({
      where: { id },
      include: {
        team: true,
        policy: {
          select: { id: true, name: true },
        },
        incidents: {
          where: incidentWhere as any,
          include: {
            assignee: {
              select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
            },
            team: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: INCIDENTS_PER_PAGE,
        },
        _count: {
          select: { incidents: { where: incidentWhere as any } },
        },
      },
    }),
    prisma.incident.count({ where: { serviceId: id } }),
    calculateSLAMetrics({
      serviceId: id,
      windowDays: slaWindowDays,
      includeActiveIncidents: true,
    }),
  ]);

  if (!serviceRaw) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = serviceRaw as any;

  const dynamicStatus = slaMetrics.dynamicStatus;

  // Use the filtered count for pagination
  const filteredTotalIncidents = service._count.incidents;
  const filteredTotalPages = Math.ceil(filteredTotalIncidents / INCIDENTS_PER_PAGE);

  const permissions = await getUserPermissions();
  const canDeleteService = permissions.isAdmin;

  const activeIncidentsCount = slaMetrics.activeIncidents;
  const allTimeTotalIncidents = totalIncidentCount;

  const deleteServiceWithId = deleteService.bind(null, service.id);

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Breadcrumb / Back Link */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/services"
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Services
        </Link>
        <span className="opacity-30">/</span>
        <span className="font-medium text-foreground">{service.name}</span>
      </div>

      {/* Header Section */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground rounded-lg p-4 md:p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={dynamicStatus} />
              {service.team && (
                <Badge variant="secondary" size="xs" className="gap-1.5">
                  {service.team.name}
                </Badge>
              )}
              {service.slaTier && (
                <Badge variant="secondary" size="xs" className="gap-1.5">
                  SLA {service.slaTier}
                </Badge>
              )}
              {service.region && (
                <Badge variant="secondary" size="xs" className="gap-1.5">
                  <Globe className="h-3.5 w-3.5 opacity-70" />
                  {service.region}
                </Badge>
              )}
            </div>

            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
                {service.name}
              </h1>
              {service.description && (
                <p className="text-xs md:text-sm opacity-90 max-w-3xl">{service.description}</p>
              )}
              <p className="text-[11px] md:text-xs opacity-80 mt-1">
                Metrics shown for the last 30 days.
              </p>
              <p className="text-[11px] md:text-xs opacity-80">
                Active incident counts exclude snoozed and suppressed incidents.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-2 bg-white text-slate-900" asChild>
              <Link href={`/services/${id}/integrations`}>
                <Zap className="h-4 w-4" />
                Integrations
              </Link>
            </Button>
            <Button variant="outline" className="gap-2 bg-white text-slate-900" asChild>
              <Link href={`/services/${id}/settings`}>
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </Button>
            {canDeleteService && (
              <DeleteServiceButton
                action={deleteServiceWithId}
                serviceName={service.name}
                incidentCount={allTimeTotalIncidents}
                hasOpenIncidents={activeIncidentsCount > 0}
                className="bg-white hover:bg-red-50 border-white/40 text-red-600 hover:text-red-700 hover:border-red-200"
              />
            )}
          </div>
        </div>

        <Suspense fallback={<ServiceMetricsSkeleton />}>
          <ServiceMetricsSummary serviceId={id} />
        </Suspense>
      </div>

      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList className="bg-muted/50 p-1 rounded-xl">
          <TabsTrigger
            value="incidents"
            asChild
            className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm cursor-pointer"
          >
            <Link href={`/services/${id}?tab=incidents`}>Active Incidents</Link>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            asChild
            className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm cursor-pointer"
          >
            <Link href={`/services/${id}?tab=history`}>Incident History</Link>
          </TabsTrigger>
          <TabsTrigger
            value="dependencies"
            className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            disabled
          >
            Dependencies
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {tab === 'incidents' ? 'Active Incidents' : 'Incident History'}
              </h3>
              <p className="text-sm text-slate-500">
                {tab === 'incidents'
                  ? 'Viewing incidents currently affecting this service.'
                  : 'Viewing Resolved and Closed incidents.'}
              </p>
            </div>
            {tab === 'incidents' && <CreateIncidentButton serviceId={id} className="gap-2" />}
          </div>

          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <IncidentList
              incidents={(service as any).incidents.map((i: any) => ({
                id: i.id,
                title: i.title,
                status: i.status === 'RESOLVED' && tab === 'incidents' ? 'OPEN' : i.status, // Safety fallback, though query handles it
                urgency: i.urgency,
                priority: i.priority,
                createdAt: i.createdAt,
                resolvedAt: i.resolvedAt,
                assignee: i.assignee,
                team: i.team,
              }))}
              serviceId={id}
            />

            {filteredTotalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={filteredTotalPages}
                totalItems={filteredTotalIncidents}
                itemsPerPage={INCIDENTS_PER_PAGE}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
