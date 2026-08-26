import prisma from '@/lib/prisma';
import Link from 'next/link';
import { getUserPermissions } from '@/lib/rbac';
import IncidentsListTable from '@/components/incident/IncidentsListTable';
import IncidentsFilters from '@/components/incident/IncidentsFilters';
import {
  buildIncidentOrderBy,
  buildIncidentWhere,
  incidentListSelect,
  normalizeIncidentFilter,
  normalizeIncidentSort,
} from '@/lib/incidents-query';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { AlertTriangle } from 'lucide-react';

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
  }>;
}) {
  const params = await searchParams;
  const currentFilter = normalizeIncidentFilter(params.filter);
  const currentSearch = params.search || '';
  const currentPriority = params.priority || 'all';
  const currentUrgency = params.urgency || 'all';
  const currentSort = normalizeIncidentSort(params.sort);
  const currentTeamId = params.teamId || 'all';
  const currentPage = parseInt(params.page || '1', 10);
  const skip = (currentPage - 1) * ITEMS_PER_PAGE;

  const permissions = await getUserPermissions();
  const canCreateIncident = permissions.isResponderOrAbove;

  const currentUser = await prisma.user.findUnique({
    where: { id: permissions.id },
    select: {
      id: true,
      name: true,
      email: true,
      teamMemberships: { select: { teamId: true } },
    },
  });

  const userTeamIds = currentUser?.teamMemberships.map(t => t.teamId) || [];

  // FIX: Fetch ALL teams for the filter dropdown, not just teams the user is in
  const allTeams = await prisma.team.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const where = buildIncidentWhere({
    filter: currentFilter,
    search: currentSearch,
    priority: currentPriority,
    urgency: currentUrgency,
    assigneeId: currentUser?.id ?? permissions.id,
  });

  if (currentTeamId !== 'all') {
    where.teamId = currentTeamId === 'mine' ? { in: userTeamIds } : currentTeamId;
  }

  const orderBy = buildIncidentOrderBy(currentSort);

  const statsBase = {
    search: currentSearch,
    priority: currentPriority,
    urgency: currentUrgency,
    assigneeId: currentUser?.id ?? permissions.id,
  };

  // Optimized: Use groupBy for status counts instead of 5 separate count() queries
  const baseWhere = buildIncidentWhere({ filter: 'all', ...statsBase });
  const [statusCounts, mineCount] = await Promise.all([
    // Single groupBy query for all status counts
    prisma.incident.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    }),
    // Separate query for "mine" since it has additional assigneeId filter
    prisma.incident.count({ where: buildIncidentWhere({ filter: 'mine', ...statsBase }) }),
  ]);

  // Aggregate status counts from groupBy result
  const statusCountMap = new Map(statusCounts.map(s => [s.status, s._count._all]));
  const activeCount = (statusCountMap.get('OPEN') || 0) + (statusCountMap.get('ACKNOWLEDGED') || 0);
  const resolvedCount = statusCountMap.get('RESOLVED') || 0;
  const snoozedCount = statusCountMap.get('SNOOZED') || 0;
  const suppressedCount = statusCountMap.get('SUPPRESSED') || 0;

  const totalCount = await prisma.incident.count({ where });
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const incidents = await prisma.incident.findMany({
    where,
    select: incidentListSelect,
    orderBy,
    skip,
    take: ITEMS_PER_PAGE,
  });

  const users = canCreateIncident
    ? await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        orderBy: { name: 'asc' },
      })
    : [];

  const showingFrom = totalCount === 0 ? 0 : skip + 1;
  const showingTo = Math.min(skip + ITEMS_PER_PAGE, totalCount);

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Metric panel: keep same */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white rounded-lg p-4 md:p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 text-white">
              <AlertTriangle className="h-6 w-6 md:h-8 md:w-8" />
              Incidents
            </h1>
            <p className="text-xs md:text-sm opacity-90 mt-1 text-white">
              Triage, assign, and resolve operational issues
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-4 w-full lg:w-auto">
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold">{mineCount}</div>
                <div className="text-[10px] md:text-xs opacity-90">Mine</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-red-200">{activeCount}</div>
                <div className="text-[10px] md:text-xs opacity-90">Active</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-green-200">
                  {resolvedCount}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Resolved</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-yellow-200">
                  {snoozedCount}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Snoozed</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-gray-200">
                  {suppressedCount}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Suppressed</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

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
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>
              Showing {showingFrom}-{showingTo} of {totalCount} incidents
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
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
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
