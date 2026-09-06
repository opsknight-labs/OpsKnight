import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import DashboardRealtimeWrapper from '@/components/DashboardRealtimeWrapper';
import DashboardCommandCenter from '@/components/dashboard/DashboardCommandCenter';
import DashboardIncidentFilters from '@/components/dashboard/DashboardIncidentFilters';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import QuickActionsPanel from '@/components/dashboard/QuickActionsPanel';
import OnCallWidget from '@/components/dashboard/OnCallWidget';
import SmartInsightsBanner from '@/components/dashboard/SmartInsightsBanner';
import {
  getRangeLabel,
  type DashboardFilters as DashboardFilterParams,
} from '@/lib/dashboard-utils';
import { IncidentListItem } from '@/types/incident-list';

// New Imports for SLA Breach Widget
import { WidgetProvider } from '@/components/dashboard/WidgetProvider';
import SLABreachAlertsWidget from '@/components/dashboard/widgets/SLABreachAlertsWidget';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Activity,
  AlertTriangle,
  List,
  Siren,
  UserRound,
  CheckCircle2,
} from 'lucide-react';
import { IncidentStatus, IncidentUrgency } from '@prisma/client';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  dashboardUserReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getDashboardOperationalSnapshot } from '@/lib/dashboard/dashboard-operational-snapshot';
import { DashboardAnalyticsProvider } from '@/components/dashboard/DashboardAnalyticsProvider';
import {
  DashboardAnalyticsHeatmap,
  DashboardPerformanceAnalytics,
  DashboardTeamLoadAnalytics,
} from '@/components/dashboard/DashboardAnalyticsWidgets';

export const revalidate = 0;

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
  const serviceAccess = serviceReadWhere(actor);
  const userAccess = dashboardUserReadWhere(actor);

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

  const assigneeFilter = assignee !== undefined ? (assignee === '' ? null : assignee) : undefined;
  const [operational, services, users] = await Promise.all([
    getDashboardOperationalSnapshot(actor, filterParams, sortBy, sortOrder),
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
  ]);
  const metricDataState = operational.asOf ? ('available' as const) : ('unavailable' as const);
  const metricsAsOf = operational.asOf;
  const incidents = operational.previewIncidents;
  const recentIncidents = operational.recentIncidents;
  const criticalFocusIncidents = operational.criticalFocus;
  const myQueueIncidents = operational.myQueue;
  const myQueueCount = operational.myQueueCount;
  const widgetData = {
    activeIncidents: operational.slaBreachAlerts,
    slaBreachAlerts: operational.slaBreachAlerts,
    userOnCall: { isOnCall: false, shiftStart: null, shiftEnd: null, assignedIncidents: myQueueCount },
    slaMetrics: { mtta: null, mttr: null, ackCompliance: null, resolveCompliance: null, trendMtta: 'stable' as const, trendMttr: 'stable' as const },
    serviceHealth: [],
    recentActivity: [],
    teamWorkload: [],
    lastUpdated: new Date(operational.asOf),
  };

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
  const activeShifts = operational.currentShifts;
  const metricsTotalCount = operational.totalInRange;
  const currentTriggeredCount = operational.open;
  const metricsResolvedCount = operational.resolvedInRange;
  const currentAcknowledgedCount = operational.acknowledged;
  const currentActiveCount = currentTriggeredCount + currentAcknowledgedCount;
  const currentSnoozedCount = operational.snoozed;
  const currentSuppressedCount = operational.suppressed;
  const currentMutedCount = currentSnoozedCount + currentSuppressedCount;
  const unassignedCount = operational.unassigned;
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
    createdAfter: operational.effectiveStart.toISOString(),
    createdBefore: operational.effectiveEnd.toISOString(),
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

  const allActiveIncidentsCount = operational.active;
  const currentCriticalActive = Math.max(
    operational.critical,
    criticalFocusIncidents.length
  );

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

  const criticalFocusFallback = incidentListItems
    .filter(
      inc =>
        (inc.status === 'OPEN' || inc.status === 'ACKNOWLEDGED') &&
        (inc.urgency === 'HIGH' || inc.priority === 'P1')
    )
    .slice(0, 3);

  const criticalFocus =
    criticalFocusIncidents.length > 0 ? criticalFocusIncidents.slice(0, 3) : criticalFocusFallback;
  const myQueueItems = myQueueIncidents.slice(0, 3);
  const servicesAtRisk = operational.serviceLoads
    .map(load => ({
      id: load.serviceId,
      name: services.find(item => item.id === load.serviceId)?.name ?? 'Unknown service',
      activeCount: load.activeCount,
      criticalCount: load.criticalCount,
    }))
    .sort((left, right) => right.activeCount - left.activeCount)
    .slice(0, 4);
  const topServiceByVolume = servicesAtRisk[0]
    ? { ...servicesAtRisk[0], count: servicesAtRisk[0].activeCount }
    : undefined;

  return (
    <DashboardRealtimeWrapper>
      <DashboardAnalyticsProvider
        query={{
          range,
          startDate: customStart,
          endDate: customEnd,
          service,
          assignee: assignee === '' ? 'unassigned' : assignee,
          urgency,
          status,
        }}
      >
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
          isClipped={operational.isClipped}
          retentionDays={operational.retentionDays}
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
          />
        ) : (
          <div
            className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-900 dark:text-amber-100 mb-6 shadow-xs border-l-4 border-l-amber-500"
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
                          {myQueueCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card shadow-sm">
                              {myQueueCount}
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
                            ? buildIncidentListHref({
                                filter: 'all_open',
                                assignee: user.id,
                                ...(service ? { serviceId: service } : {}),
                              })
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
                          {currentCriticalActive > 0 ? (
                            <>
                              <Siren className="w-6 h-6 mx-auto text-rose-500 mb-2 animate-pulse" />
                              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                                {currentCriticalActive} active critical incident
                                {currentCriticalActive === 1 ? '' : 's'}
                              </p>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500 mb-2" />
                              <p className="text-xs text-muted-foreground font-medium">
                                All systems stable
                              </p>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {criticalFocus.map(incident => (
                            <Link
                              key={incident.id}
                              href={`/incidents/${incident.id}`}
                              className="block p-2.5 rounded-xl bg-muted/40 border border-border/70 hover:border-border hover:bg-muted/70 hover:shadow-2xs transition-all duration-150"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-2 h-2 rounded-full bg-rose-500 shrink-0 shadow-sm animate-pulse" />
                                <p className="text-xs font-semibold text-foreground truncate flex-1">
                                  {incident.title}
                                </p>
                                {incident.priority && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
                                    {incident.priority}
                                  </span>
                                )}
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                      <Link
                        href={buildIncidentListHref({
                          filter: 'all_open',
                          urgency: 'HIGH',
                          ...(service ? { serviceId: service } : {}),
                        })}
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
            <DashboardAnalyticsHeatmap />

            <IncidentsListTable
              incidents={recentIncidentListItems}
              users={users}
              canManageIncidents={false}
              readOnly={true}
              title="Latest incidents"
              showExport={false}
              realtimeFilter={{
                status,
                serviceId: service,
                assignee: assignee === '' ? 'unassigned' : assignee,
                urgency,
                search,
                createdAfter: operational.effectiveStart.toISOString(),
                createdBefore: operational.effectiveEnd.toISOString(),
              }}
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
            <DashboardPerformanceAnalytics />
            <DashboardTeamLoadAnalytics />
          </aside>
        </div>
      </div>
      </DashboardAnalyticsProvider>
    </DashboardRealtimeWrapper>
  );
}
