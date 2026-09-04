import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { calculateSLAMetrics } from '@/lib/sla-server';
import DashboardRealtimeWrapper from '@/components/DashboardRealtimeWrapper';
import DashboardCommandCenter from '@/components/dashboard/DashboardCommandCenter';
import DashboardIncidentFilters from '@/components/dashboard/DashboardIncidentFilters';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import QuickActionsPanel from '@/components/dashboard/QuickActionsPanel';
import OnCallWidget from '@/components/dashboard/OnCallWidget';
import SidebarWidget, { WIDGET_ICON_BG } from '@/components/dashboard/SidebarWidget';
import CompactPerformanceMetrics from '@/components/dashboard/compact/CompactPerformanceMetrics';
import CompactTeamLoad from '@/components/dashboard/compact/CompactTeamLoad';
import SmartInsightsBanner from '@/components/dashboard/SmartInsightsBanner';
import {
  buildRetainedDateFilter,
  buildIncidentWhere,
  buildIncidentOrderBy,
  getRangeLabel,
  type DashboardFilters as DashboardFilterParams,
} from '@/lib/dashboard-utils';
import { IncidentListItem } from '@/types/incident-list';

// New Imports for SLA Breach Widget
import { getWidgetData } from '@/lib/widget-data-provider';
import { WidgetProvider } from '@/components/dashboard/WidgetProvider';
import SLABreachAlertsWidget from '@/components/dashboard/widgets/SLABreachAlertsWidget';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Activity,
  AlertTriangle,
  List,
  ShieldAlert,
  Siren,
  UserRound,
  CheckCircle2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { IncidentHeatmapWidget } from '@/components/dashboard/widgets/IncidentHeatmapWidget';
import { IncidentStatus, IncidentUrgency } from '@prisma/client';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  dashboardMetricsScope,
  dashboardUserReadWhere,
  incidentReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export const revalidate = 0;

const INCIDENTS_PREVIEW_LIMIT = 20;
const DASHBOARD_RECENT_INCIDENTS_LIMIT = 15;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getServerSession(await getAuthOptions());
  const awaitedSearchParams = await searchParams;

  // Extract search params
  const statusParam =
    typeof awaitedSearchParams.status === 'string' ? awaitedSearchParams.status : undefined;
  const status =
    statusParam &&
    ['ACTIVE', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'].includes(statusParam)
      ? statusParam
      : undefined;
  const assigneeParam =
    typeof awaitedSearchParams.assignee === 'string' ? awaitedSearchParams.assignee : undefined;
  const assignee =
    assigneeParam === undefined || assigneeParam === 'all' ? undefined : assigneeParam;
  const serviceParam =
    typeof awaitedSearchParams.service === 'string' ? awaitedSearchParams.service : undefined;
  const service = serviceParam && serviceParam !== 'all' ? serviceParam : undefined;
  const search = typeof awaitedSearchParams.search === 'string' ? awaitedSearchParams.search : '';
  const urgencyParam =
    typeof awaitedSearchParams.urgency === 'string' ? awaitedSearchParams.urgency : undefined;
  const urgency = (
    ['HIGH', 'MEDIUM', 'LOW'].includes(urgencyParam || '') ? urgencyParam : undefined
  ) as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
  const sortBy =
    typeof awaitedSearchParams.sortBy === 'string' ? awaitedSearchParams.sortBy : undefined;
  const sortOrderParam =
    typeof awaitedSearchParams.sortOrder === 'string' ? awaitedSearchParams.sortOrder : undefined;
  const sortOrder = sortOrderParam === 'asc' || sortOrderParam === 'desc' ? sortOrderParam : 'desc';
  const range = typeof awaitedSearchParams.range === 'string' ? awaitedSearchParams.range : '30';
  const customStart =
    typeof awaitedSearchParams.startDate === 'string' ? awaitedSearchParams.startDate : undefined;
  const customEnd =
    typeof awaitedSearchParams.endDate === 'string' ? awaitedSearchParams.endDate : undefined;
  const currentSort =
    sortBy === 'createdAt' && sortOrder === 'asc'
      ? 'oldest'
      : sortBy === 'status'
        ? 'status'
        : sortBy === 'urgency'
          ? 'urgency'
          : sortBy === 'title'
            ? 'title'
            : 'newest';

  // Get user name for greeting
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          timeZone: true,
          role: true,
          status: true,
          teamMemberships: { select: { teamId: true } },
        },
      })
    : null;
  const userName = user?.name || 'there';
  const userTimeZone = user?.timeZone || 'UTC';
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('Authenticated dashboard user is unavailable.');
  }
  const actor: AuthorizationActor = {
    id: user.id,
    role: user.role,
    status: user.status,
    teamIds: user.teamMemberships.map(membership => membership.teamId),
  };
  const incidentAccess = incidentReadWhere(actor);
  const serviceAccess = serviceReadWhere(actor);
  const userAccess = dashboardUserReadWhere(actor);
  const metricsScope = dashboardMetricsScope(actor);

  // Build filters using utility functions
  const filterParams: DashboardFilterParams = {
    status,
    service,
    assignee,
    urgency,
    search,
    range,
    customStart,
    customEnd,
  };

  // Main query where clause (includes status filter)
  const dateFilter = await buildRetainedDateFilter(range, customStart, customEnd);
  const dashboardWhere = buildIncidentWhere(filterParams, { dateFilter: dateFilter.where });
  const where = { AND: [incidentAccess, dashboardWhere] };

  // Date filter for SLA calculations
  const metricsStartDate = dateFilter.window.start;
  const metricsEndDate = dateFilter.window.end;
  const assigneeFilter = assignee !== undefined ? (assignee === '' ? null : assignee) : undefined;
  const incidentSelect = {
    id: true,
    title: true,
    status: true,
    urgency: true,
    priority: true,
    createdAt: true,
    assigneeId: true,
    teamId: true,
    escalationStatus: true,
    currentEscalationStep: true,
    nextEscalationAt: true,
    service: {
      select: {
        id: true,
        name: true,
      },
    },
    team: {
      select: {
        id: true,
        name: true,
      },
    },
    assignee: {
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        gender: true,
      },
    },
  };

  // Fetch Data in Parallel
  const [incidents, recentIncidents, services, users, slaMetrics] = await Promise.all([
    prisma.incident.findMany({
      where,
      select: incidentSelect,
      orderBy: buildIncidentOrderBy(sortBy, sortOrder),
      take: INCIDENTS_PREVIEW_LIMIT,
    }),
    prisma.incident.findMany({
      where,
      select: incidentSelect,
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_RECENT_INCIDENTS_LIMIT,
    }),
    prisma.service.findMany({
      where: serviceAccess,
      select: {
        id: true,
        name: true,
        status: true,
      },
    }),
    prisma.user.findMany({
      where: userAccess,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        role: true,
        avatarUrl: true,
        gender: true,
      },
      orderBy: { name: 'asc' },
    }),
    // Fail-safe wrapper for SLA metrics
    calculateSLAMetrics({
      serviceId: service,
      assigneeId: assigneeFilter,
      urgency: urgency as 'HIGH' | 'MEDIUM' | 'LOW' | undefined,
      status: status as 'ACTIVE' | IncidentStatus | undefined,
      startDate: metricsStartDate,
      endDate: metricsEndDate,
      includeAllTime: range === 'all',
      includeIncidents: true,
      includeActiveIncidents: true,
      incidentLimit: 5,
      ...metricsScope,
    }).catch(err => {
      console.error('Failed to load SLA metrics:', err);
      // Return safe default object matching return type
      return {
        totalIncidents: 0,
        activeIncidents: 0,
        activeCount: 0,
        openCount: 0,
        acknowledgedCount: 0,
        snoozedCount: 0,
        suppressedCount: 0,
        resolvedCount: 0,
        criticalCount: 0,
        highUrgencyCount: 0,
        mediumUrgencyCount: 0,
        lowUrgencyCount: 0,
        mttr: 0,
        mttd: 0, // Mean Time to Detect/Ack
        ackCompliance: 100,
        resolveCompliance: 100,
        statusMix: [],
        currentShifts: [],
        unassignedActive: 0,
        assigneeLoad: [],
        serviceMetrics: [],
        activeIncidentSummaries: [],
        heatmapData: [],
        isClipped: false,
        retentionDays: 30,
        _metricDataState: 'unavailable' as const,
      };
    }),
  ]);

  const metricDataState =
    '_metricDataState' in slaMetrics ? slaMetrics._metricDataState : ('available' as const);
  const metricsAsOf = new Date().toISOString();

  // Derive widget data from already calculated SLA metrics (no duplicate database calls)
  const widgetData =
    user && metricDataState === 'available'
      ? await getWidgetData(
          user.id,
          'user',
          {
            serviceId: service,
            assigneeId: assigneeFilter,
            urgency: urgency as 'HIGH' | 'MEDIUM' | 'LOW' | undefined,
            status: status as 'ACTIVE' | IncidentStatus | undefined,
            startDate: metricsStartDate,
            endDate: metricsEndDate,
            includeAllTime: range === 'all',
            ...metricsScope,
          },
          slaMetrics
        ).catch(err => {
          console.error('Failed to load widget data:', err);
          return null;
        })
      : null;

  // Transform incidents for the list table
  const incidentListItems: IncidentListItem[] = incidents.map(inc => ({
    ...inc,
    status: inc.status as IncidentStatus,
    urgency: inc.urgency as IncidentUrgency,
  }));
  const recentIncidentListItems: IncidentListItem[] = recentIncidents.map(inc => ({
    ...inc,
    status: inc.status as IncidentStatus,
    urgency: inc.urgency as IncidentUrgency,
  }));

  // Map SLA Server metrics to Dashboard variables
  const activeShifts = slaMetrics.currentShifts;
  const metricsTotalCount = slaMetrics.totalIncidents;
  const currentTriggeredCount = slaMetrics.openCount;
  const metricsResolvedCount = slaMetrics.statusMix.find(s => s.status === 'RESOLVED')?.count ?? 0;
  const currentAcknowledgedCount = slaMetrics.acknowledgedCount;
  const currentActiveCount = currentTriggeredCount + currentAcknowledgedCount;
  const currentSnoozedCount = slaMetrics.snoozedCount;
  const currentSuppressedCount = slaMetrics.suppressedCount;
  const currentMutedCount = currentSnoozedCount + currentSuppressedCount;
  const unassignedCount = slaMetrics.unassignedActive;
  const listAssignee =
    assigneeFilter === null ? ('unassigned' as const) : (assigneeFilter ?? undefined);
  const strictStatus = status && status !== 'ACTIVE' ? (status as IncidentStatus) : undefined;
  const currentListScope = {
    serviceId: service,
    assignee: listAssignee,
    urgency,
  };
  const periodListScope = {
    ...currentListScope,
    createdAfter: ('effectiveStart' in slaMetrics
      ? slaMetrics.effectiveStart
      : metricsStartDate
    )?.toISOString(),
    createdBefore: ('effectiveEnd' in slaMetrics
      ? slaMetrics.effectiveEnd
      : metricsEndDate
    )?.toISOString(),
  };
  const totalHref = buildIncidentListHref({
    ...periodListScope,
    ...(status === 'ACTIVE'
      ? { filter: 'all_open' as const }
      : strictStatus
        ? { status: strictStatus }
        : {}),
  });
  const activeHref =
    !status || status === 'ACTIVE'
      ? buildIncidentListHref({ ...currentListScope, filter: 'all_open' })
      : status === 'OPEN' || status === 'ACKNOWLEDGED'
        ? buildIncidentListHref({ ...currentListScope, status })
        : undefined;
  const mutedHref = !status
    ? buildIncidentListHref({ ...currentListScope, filter: 'muted' })
    : status === 'SNOOZED' || status === 'SUPPRESSED'
      ? buildIncidentListHref({ ...currentListScope, status })
      : undefined;
  const resolvedHref =
    !status || status === 'RESOLVED'
      ? buildIncidentListHref({ ...periodListScope, filter: 'resolved' })
      : undefined;
  const unassignedHref = activeHref
    ? buildIncidentListHref({
        ...currentListScope,
        assignee: 'unassigned',
        ...(status === 'OPEN' || status === 'ACKNOWLEDGED'
          ? { status }
          : { filter: 'all_open' as const }),
      })
    : undefined;

  const allActiveIncidentsCount =
    slaMetrics.activeIncidents ??
    slaMetrics.activeCount ??
    slaMetrics.openCount + slaMetrics.acknowledgedCount;
  const currentCriticalActive = slaMetrics.criticalCount;
  const mttaMinutes = slaMetrics.mttd;

  // Calculate system status
  const systemStatus =
    metricDataState === 'unavailable'
      ? { label: 'DATA UNAVAILABLE', color: 'var(--color-warning)', bg: 'rgba(245, 158, 11, 0.1)' }
      : currentCriticalActive > 0
        ? { label: 'CRITICAL', color: 'var(--color-danger)', bg: 'rgba(239, 68, 68, 0.1)' }
        : allActiveIncidentsCount > 0
          ? { label: 'DEGRADED', color: 'var(--color-warning)', bg: 'rgba(245, 158, 11, 0.1)' }
          : { label: 'OPERATIONAL', color: 'var(--color-success)', bg: 'rgba(34, 197, 94, 0.1)' };

  // Get hour in user's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: userTimeZone,
  });
  const hour = parseInt(formatter.format(new Date()), 10);

  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
  const totalInRange = metricsTotalCount;
  const rangeBadgeLabel =
    range === 'all' ? 'All time' : range === 'custom' ? 'Custom range' : `Last ${range} days`;
  // Use rawHeatmapData which comes from calculateSLAMetrics (which uses rollups for long ranges)
  const heatmapData = slaMetrics.heatmapData ?? [];

  const activeIncidentSource = (slaMetrics.activeIncidentSummaries || []).map(incident => ({
    id: incident.id,
    title: incident.title,
    status: incident.status as IncidentStatus,
    urgency: incident.urgency as IncidentUrgency,
    createdAt: incident.createdAt,
    assigneeId: incident.assigneeId,
  }));

  const activeIncidentFallback = incidentListItems.map(incident => ({
    id: incident.id,
    title: incident.title,
    status: incident.status,
    urgency: incident.urgency,
    createdAt: incident.createdAt,
    assigneeId: incident.assigneeId,
  }));

  const activeIncidentCandidates =
    activeIncidentSource.length > 0 ? activeIncidentSource : activeIncidentFallback;

  const activeIncidents = activeIncidentCandidates.filter(
    incident =>
      incident.status !== 'RESOLVED' &&
      incident.status !== 'SNOOZED' &&
      incident.status !== 'SUPPRESSED'
  );
  const criticalIncidents = activeIncidents
    .filter(incident => incident.urgency === 'HIGH')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const criticalFocus = criticalIncidents.slice(0, 3);
  const myQueueItems = user
    ? activeIncidents
        .filter(incident => incident.assigneeId === user.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 3)
    : [];
  const servicesAtRisk = slaMetrics.serviceMetrics
    .filter(serviceMetric => (serviceMetric.activeCount ?? 0) > 0)
    .sort((a, b) => (b.activeCount ?? 0) - (a.activeCount ?? 0))
    .slice(0, 4)
    .map(serviceMetric => ({
      id: serviceMetric.id,
      name: serviceMetric.name,
      activeCount: serviceMetric.activeCount ?? 0,
      criticalCount: serviceMetric.criticalCount ?? 0,
    }));

  const topServiceByVolume = slaMetrics.serviceMetrics?.[0];

  const teamLoad = slaMetrics.assigneeLoad
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return (
    <DashboardRealtimeWrapper>
      <div
        className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 min-h-screen space-y-4 sm:space-y-6"
        style={{ zoom: 0.95 }}
      >
        <DashboardCommandCenter
          systemStatus={systemStatus}
          allActiveIncidentsCount={allActiveIncidentsCount}
          totalInRange={totalInRange}
          currentActiveCount={currentActiveCount}
          currentTriggeredCount={currentTriggeredCount}
          currentMutedCount={currentMutedCount}
          currentSnoozedCount={currentSnoozedCount}
          currentSuppressedCount={currentSuppressedCount}
          metricsResolvedCount={metricsResolvedCount}
          unassignedCount={unassignedCount}
          rangeLabel={getRangeLabel(range)}
          incidents={incidents}
          filters={{
            status: status || undefined,
            service: service || undefined,
            assignee: assignee !== undefined ? assignee : undefined,
            urgency: urgency || undefined,
            search: search || undefined,
            range,
            startDate: customStart,
            endDate: customEnd,
          }}
          currentAcknowledgedCount={currentAcknowledgedCount}
          userTimeZone={userTimeZone}
          isClipped={slaMetrics.isClipped}
          retentionDays={slaMetrics.retentionDays}
          metricDataState={metricDataState}
          metricsAsOf={metricsAsOf}
          totalHref={totalHref}
          activeHref={activeHref}
          mutedHref={mutedHref}
          resolvedHref={resolvedHref}
          unassignedHref={unassignedHref}
        />

        {/* Smart Insights Banner - Auto-generated alerts */}
        {metricDataState === 'available' ? (
          <SmartInsightsBanner
            totalIncidents={totalInRange}
            activeIncidents={allActiveIncidentsCount}
            criticalIncidents={currentCriticalActive}
            unassignedIncidents={unassignedCount}
            topServiceName={topServiceByVolume?.name}
            topServiceId={topServiceByVolume?.id}
            topServiceCount={topServiceByVolume?.count}
            resolveCompliance={slaMetrics.resolveCompliance}
          />
        ) : (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            role="alert"
          >
            Incident metrics could not be calculated. Counts and automated insights are hidden to
            avoid presenting database errors as healthy zero values. Incident workflows remain
            available.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8 space-y-6">
            <DashboardIncidentFilters
              services={services}
              users={users}
              currentStatus={status ?? 'all'}
              currentUrgency={urgency ?? 'all'}
              currentService={service ?? 'all'}
              currentAssignee={
                assignee === undefined ? 'all' : assignee === '' ? 'unassigned' : assignee
              }
              currentSearch={search}
              currentSort={currentSort}
              currentRange={range}
              currentCustomStart={customStart}
              currentCustomEnd={customEnd}
              userId={user?.id ?? null}
            />

            {/* Ops Pulse Panel - Unified Container */}
            <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
              {/* Header */}
              <div className="p-4 pb-3 border-b border-border">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Activity className="w-5 h-5 text-primary" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">Ops Pulse</h3>
                      <p className="text-[10px] text-muted-foreground font-medium">
                        Signals that need attention right now
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" size="xs">
                      {rangeBadgeLabel}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Content Grid */}
              <div className="p-4">
                <div className="grid gap-5 md:grid-cols-3">
                  {/* My Queue Card */}
                  <div className="relative rounded-2xl border border-border bg-card shadow-xs hover:shadow-sm transition-all duration-200 overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="p-4 pb-2">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-border/80 flex items-center justify-center text-primary">
                            <UserRound className="w-4 h-4" />
                          </div>
                          {myQueueItems.length > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card shadow-sm">
                              {myQueueItems.length}
                            </span>
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-foreground">My Queue</h4>
                          <p className="text-[10px] text-muted-foreground font-medium">
                            Assigned to you
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="px-4 pb-4 flex-1 flex flex-col">
                      {metricDataState === 'unavailable' ? (
                        <div className="py-6 text-center">
                          <AlertTriangle className="w-6 h-6 mx-auto text-amber-500 mb-2" />
                          <p className="text-xs text-muted-foreground font-medium">
                            Queue metrics unavailable
                          </p>
                        </div>
                      ) : myQueueItems.length === 0 ? (
                        <div className="py-6 text-center">
                          <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500 mb-2" />
                          <p className="text-xs text-muted-foreground font-medium">
                            Queue is clear!
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {myQueueItems.slice(0, 3).map(item => (
                            <Link
                              key={item.id}
                              href={`/incidents/${item.id}`}
                              className="block p-2.5 rounded-xl bg-muted/40 border border-border/70 hover:border-border hover:bg-muted/70 hover:shadow-2xs transition-all duration-150"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-2 h-2 rounded-full bg-primary shrink-0 shadow-sm" />
                                <p className="text-xs font-semibold text-foreground truncate">
                                  {item.title}
                                </p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                      <Link
                        href={
                          user
                            ? `/?status=ACTIVE&assignee=${user.id}`
                            : buildIncidentListHref({ filter: 'all_open' })
                        }
                        className="flex items-center justify-center gap-1.5 mt-auto py-2 text-[11px] font-semibold text-foreground hover:text-primary bg-muted/50 hover:bg-muted rounded-lg border border-border/60 transition-colors"
                      >
                        View my queue &rarr;
                      </Link>
                    </div>
                  </div>

                  {/* Critical Focus Card */}
                  <div className="relative rounded-2xl border border-border bg-card shadow-xs hover:shadow-sm transition-all duration-200 overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="p-4 pb-2">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-200/50 flex items-center justify-center text-rose-600">
                            <Siren className="w-4 h-4" />
                          </div>
                          {currentCriticalActive > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card shadow-sm animate-pulse">
                              {currentCriticalActive}
                            </span>
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-foreground">Critical Focus</h4>
                          <p className="text-[10px] text-muted-foreground font-medium">
                            Immediate attention
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="px-4 pb-4 flex-1 flex flex-col">
                      {metricDataState === 'unavailable' ? (
                        <div className="py-6 text-center">
                          <AlertTriangle className="w-6 h-6 mx-auto text-amber-500 mb-2" />
                          <p className="text-xs text-muted-foreground font-medium">
                            Critical metrics unavailable
                          </p>
                        </div>
                      ) : criticalFocus.length === 0 ? (
                        <div className="py-6 text-center">
                          <ShieldAlert className="w-6 h-6 mx-auto text-rose-400 mb-2" />
                          <p className="text-xs text-muted-foreground font-medium">
                            All systems stable
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {criticalFocus.slice(0, 3).map(incident => (
                            <Link
                              key={incident.id}
                              href={`/incidents/${incident.id}`}
                              className="block p-2.5 rounded-xl bg-muted/40 border border-border/70 hover:border-border hover:bg-muted/70 hover:shadow-2xs transition-all duration-150"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-2 h-2 rounded-full bg-rose-500 shrink-0 shadow-sm animate-pulse" />
                                <p className="text-xs font-semibold text-foreground truncate">
                                  {incident.title}
                                </p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                      <Link
                        href={buildIncidentListHref({ filter: 'all_open', urgency: 'HIGH' })}
                        className="flex items-center justify-center gap-1.5 mt-auto py-2 text-[11px] font-semibold text-foreground hover:text-primary bg-muted/50 hover:bg-muted rounded-lg border border-border/60 transition-colors"
                      >
                        View critical &rarr;
                      </Link>
                    </div>
                  </div>

                  {/* Services at Risk Card */}
                  <div className="relative rounded-2xl border border-border bg-card shadow-xs hover:shadow-sm transition-all duration-200 overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="p-4 pb-2">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-border/80 flex items-center justify-center text-primary">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                          {servicesAtRisk.length > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card shadow-sm">
                              {servicesAtRisk.length}
                            </span>
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-foreground">Services at Risk</h4>
                          <p className="text-[10px] text-muted-foreground font-medium">
                            Active by service
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="px-4 pb-4 flex-1 flex flex-col">
                      {metricDataState === 'unavailable' ? (
                        <div className="py-6 text-center">
                          <AlertTriangle className="w-6 h-6 mx-auto text-amber-500 mb-2" />
                          <p className="text-xs text-muted-foreground font-medium">
                            Service risk unavailable
                          </p>
                        </div>
                      ) : servicesAtRisk.length === 0 ? (
                        <div className="py-6 text-center">
                          <List className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                          <p className="text-xs text-muted-foreground font-medium">
                            All services healthy
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {servicesAtRisk.slice(0, 4).map(serviceItem => (
                            <Link
                              key={serviceItem.id}
                              href={`/services/${serviceItem.id}`}
                              className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 border border-border/70 hover:border-border hover:bg-muted/70 hover:shadow-2xs transition-all duration-150"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-2 h-2 rounded-full bg-primary shrink-0 shadow-sm" />
                                <p className="text-xs font-semibold text-foreground truncate">
                                  {serviceItem.name}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/60">
                                  {serviceItem.activeCount}
                                </span>
                                {serviceItem.criticalCount > 0 && (
                                  <span className="text-[10px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded animate-pulse">
                                    {serviceItem.criticalCount}!
                                  </span>
                                )}
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                      <Link
                        href="/services"
                        className="flex items-center justify-center gap-1.5 mt-auto py-2 text-[11px] font-semibold text-foreground hover:text-primary bg-muted/50 hover:bg-muted rounded-lg border border-border/60 transition-colors"
                      >
                        View services &rarr;
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Incident Heatmap (Heartmap - User Requested) */}
            <IncidentHeatmapWidget data={heatmapData} year={new Date().getFullYear()} />

            <IncidentsListTable
              incidents={recentIncidentListItems}
              users={users}
              canManageIncidents={false}
              title="Latest incidents"
              showExport={false}
            />
          </div>

          <aside className="xl:col-span-4 space-y-6">
            <QuickActionsPanel greeting={greeting} userName={userName} />
            {widgetData && (
              <WidgetProvider initialData={widgetData}>
                <SLABreachAlertsWidget />
              </WidgetProvider>
            )}

            <OnCallWidget activeShifts={activeShifts} />
            <SidebarWidget
              title="Performance"
              iconBg={WIDGET_ICON_BG.blue}
              icon={<TrendingUp className="h-4 w-4" />}
            >
              {metricDataState === 'available' ? (
                <CompactPerformanceMetrics
                  mtta={mttaMinutes}
                  mttr={slaMetrics.mttr}
                  ackSlaRate={slaMetrics.ackCompliance}
                  resolveSlaRate={slaMetrics.resolveCompliance}
                />
              ) : (
                <p className="p-3 text-sm text-amber-700">Performance metrics unavailable.</p>
              )}
            </SidebarWidget>
            <SidebarWidget
              title="Team Load"
              iconBg={WIDGET_ICON_BG.green}
              icon={<Users className="h-4 w-4" />}
            >
              {metricDataState === 'available' ? (
                <CompactTeamLoad assigneeLoad={teamLoad} />
              ) : (
                <p className="p-3 text-sm text-amber-700">Team-load metrics unavailable.</p>
              )}
            </SidebarWidget>
          </aside>
        </div>
      </div>
    </DashboardRealtimeWrapper>
  );
}
