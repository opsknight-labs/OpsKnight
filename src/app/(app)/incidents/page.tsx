import prisma from '@/lib/prisma';
import Link from 'next/link';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import {
  dashboardUserReadWhere,
  incidentReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import IncidentsFilters from '@/components/incident/IncidentsFilters';
import {
  buildIncidentOrderBy,
  buildIncidentWhere,
  incidentListSelect,
  normalizeIncidentFilter,
  normalizeIncidentSort,
  normalizeIncidentStatus,
} from '@/lib/incidents-query';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { AlertTriangle, User, AlertCircle, CheckCircle2, Clock, ShieldOff } from 'lucide-react';
import { RealtimeProvider } from '@/hooks/useRealtime';

export const revalidate = 0;

const ITEMS_PER_PAGE = 50;

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    search?: string;
    priority?: string;
    urgency?: string;
    sort?: string;
    page?: string;
    teamId?: string;
    status?: string;
    assignee?: string;
    serviceId?: string;
    createdAfter?: string;
    createdBefore?: string;
  }>;
}) {
  const params = await searchParams;
  const currentFilter = normalizeIncidentFilter(params.filter);
  const currentSearch = params.search || '';
  const currentPriority = params.priority || 'all';
  const currentUrgency = params.urgency || 'all';
  const currentSort = normalizeIncidentSort(params.sort);
  const currentTeamId = params.teamId || 'all';
  const currentStatus = normalizeIncidentStatus(params.status);
  const currentAssignee = params.assignee;
  const currentServiceId = params.serviceId;
  const createdAfter = params.createdAfter ? new Date(params.createdAfter) : undefined;
  const createdBefore = params.createdBefore ? new Date(params.createdBefore) : undefined;
  const validCreatedAfter =
    createdAfter && !Number.isNaN(createdAfter.getTime()) ? createdAfter : undefined;
  const validCreatedBefore =
    createdBefore && !Number.isNaN(createdBefore.getTime()) ? createdBefore : undefined;
  const currentPage = parseInt(params.page || '1', 10);
  const skip = (currentPage - 1) * ITEMS_PER_PAGE;

  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);
  const canCreateIncident = permissions.capabilities.some(
    capability => capability === 'incident.create.all' || capability === 'incident.create.scoped'
  );

  const userTeamIds = [...actor.teamIds];

  const allTeams = await prisma.team.findMany({
    where: teamReadWhere(actor),
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const where = buildIncidentWhere({
    filter: currentFilter,
    search: currentSearch,
    priority: currentPriority,
    urgency: currentUrgency,
    assigneeId: actor.id,
    assignee: currentAssignee,
    serviceId: currentServiceId,
    status: currentStatus,
    createdAfter: validCreatedAfter,
    createdBefore: validCreatedBefore,
  });

  if (currentTeamId !== 'all') {
    where.teamId = currentTeamId === 'mine' ? { in: userTeamIds } : currentTeamId;
  }
  const effectiveWhere = { AND: [incidentReadWhere(actor), where] };

  const orderBy = buildIncidentOrderBy(currentSort);

  const statsBase = {
    search: currentSearch,
    priority: currentPriority,
    urgency: currentUrgency,
    assigneeId: actor.id,
    assignee: currentAssignee,
    serviceId: currentServiceId,
    createdAfter: validCreatedAfter,
    createdBefore: validCreatedBefore,
  };

  // Optimized: Use groupBy for status counts instead of 5 separate count() queries
  const baseWhere = buildIncidentWhere({ filter: 'all', ...statsBase });
  if (currentTeamId !== 'all') {
    baseWhere.teamId = currentTeamId === 'mine' ? { in: userTeamIds } : currentTeamId;
  }
  const effectiveBaseWhere = { AND: [incidentReadWhere(actor), baseWhere] };
  const mineWhere = buildIncidentWhere({ filter: 'mine', ...statsBase });
  if (currentTeamId !== 'all') {
    mineWhere.teamId = currentTeamId === 'mine' ? { in: userTeamIds } : currentTeamId;
  }
  const [statusCounts, mineCount] = await Promise.all([
    // Single groupBy query for all status counts
    prisma.incident.groupBy({
      by: ['status'],
      where: effectiveBaseWhere,
      _count: { _all: true },
    }),
    // Separate query for "mine" since it has additional assigneeId filter
    prisma.incident.count({ where: { AND: [incidentReadWhere(actor), mineWhere] } }),
  ]);

  // Aggregate status counts from groupBy result
  const statusCountMap = new Map(statusCounts.map(s => [s.status, s._count._all]));
  const activeCount = (statusCountMap.get('OPEN') || 0) + (statusCountMap.get('ACKNOWLEDGED') || 0);
  const resolvedCount = statusCountMap.get('RESOLVED') || 0;
  const snoozedCount = statusCountMap.get('SNOOZED') || 0;
  const suppressedCount = statusCountMap.get('SUPPRESSED') || 0;

  const totalCount = await prisma.incident.count({ where: effectiveWhere });
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const incidents = await prisma.incident.findMany({
    where: effectiveWhere,
    select: incidentListSelect,
    orderBy,
    skip,
    take: ITEMS_PER_PAGE,
  });

  const users = canCreateIncident
    ? await prisma.user.findMany({
        where: { AND: [{ status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        orderBy: { name: 'asc' },
      })
    : [];

  const drilldownScope = [
    currentStatus
      ? `Status: ${currentStatus === 'OPEN' ? 'Triggered' : currentStatus.toLowerCase()}`
      : null,
    currentAssignee
      ? currentAssignee.toLowerCase() === 'unassigned'
        ? 'Assignee: Unassigned'
        : 'Assignee: Specific responder'
      : null,
    currentServiceId ? 'Service: Specific service' : null,
    validCreatedAfter ? `Created after: ${validCreatedAfter.toISOString().slice(0, 10)}` : null,
    validCreatedBefore ? `Created before: ${validCreatedBefore.toISOString().slice(0, 10)}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header with 5-Stat Drilldown Pills */}
      <DetailHeroBanner
        tag="Real-Time Response Center"
        title="Incidents"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            {validCreatedAfter || validCreatedBefore
              ? 'Counts scoped to the selected incident creation period'
              : 'Monitor real-time outages, coordinate incident triage, manage on-call assignments, and restore services.'}
          </p>
        }
        stats={[
          {
            label: 'Mine',
            value: mineCount,
            icon: <User className="h-3.5 w-3.5" />,
            href: '/incidents?filter=mine',
            active: currentFilter === 'mine',
          },
          {
            label: 'Active',
            value: activeCount,
            icon: <AlertCircle className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: activeCount > 0 ? 'text-rose-200' : undefined,
            href: '/incidents?filter=all',
            active:
              currentFilter === 'all' &&
              (!currentStatus || currentStatus === 'OPEN' || currentStatus === 'ACKNOWLEDGED'),
          },
          {
            label: 'Resolved',
            value: resolvedCount,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: resolvedCount > 0 ? 'text-emerald-200' : undefined,
            href: '/incidents?status=RESOLVED',
            active: currentStatus === 'RESOLVED',
          },
          {
            label: 'Snoozed',
            value: snoozedCount,
            icon: <Clock className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: snoozedCount > 0 ? 'text-amber-200' : undefined,
            href: '/incidents?status=SNOOZED',
            active: currentStatus === 'SNOOZED',
          },
          {
            label: 'Suppressed',
            value: suppressedCount,
            icon: <ShieldOff className="h-3.5 w-3.5 text-slate-200" />,
            valueClassName: suppressedCount > 0 ? 'text-slate-200' : undefined,
            href: '/incidents?status=SUPPRESSED',
            active: currentStatus === 'SUPPRESSED',
          },
        ]}
      />

      {drilldownScope.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-semibold text-foreground">Metric drill-down:</span>
          <span className="text-muted-foreground">{drilldownScope.join(' · ')}</span>
          <Link href="/incidents" className="ml-auto font-semibold text-primary hover:underline">
            Clear scope
          </Link>
        </div>
      )}

      {/* Single-column layout with inline filters */}
      <div className="space-y-4 md:space-y-5">
        {/* Filters Panel */}
        <IncidentsFilters
          currentFilter={currentFilter}
          currentSort={currentSort}
          currentPriority={currentPriority}
          currentUrgency={currentUrgency}
          currentSearch={currentSearch}
          currentTeamId={currentTeamId}
          teams={allTeams}
          canCreateIncident={canCreateIncident}
        />

        {/* List */}
        <RealtimeProvider>
          <IncidentsListTable
            incidents={incidents}
            users={users}
            canManageIncidents={permissions.isResponderOrAbove}
            pagination={{
              currentPage,
              totalPages,
              totalItems: totalCount,
              itemsPerPage: ITEMS_PER_PAGE,
            }}
            realtimeFilter={{
              filter: currentFilter,
              actorId: actor.id,
              status: currentStatus,
              assignee: currentAssignee,
              serviceId: currentServiceId,
              urgency: currentUrgency,
              priority: currentPriority,
              teamId: currentTeamId,
              search: currentSearch,
              createdAfter: validCreatedAfter?.toISOString(),
              createdBefore: validCreatedBefore?.toISOString(),
            }}
          />
        </RealtimeProvider>
      </div>
    </div>
  );
}
