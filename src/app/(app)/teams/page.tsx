import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getUserPermissions } from '@/lib/rbac';
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  removeTeamMember,
  updateTeam,
  updateTeamMemberRole,
  updateTeamMemberNotifications,
} from './actions';
import { logger } from '@/lib/logger';
import TeamCreateForm from '@/components/TeamCreateForm';
import TeamCard from '@/components/TeamCard';
import TeamFilters from '@/components/teams/TeamFilters';
import Link from 'next/link';
import TeamSortDropdown from '@/components/teams/TeamSortDropdown';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Users, Shield, TrendingUp, ArrowUpDown, AlertCircle } from 'lucide-react';

type TeamsPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

const TEAMS_PER_PAGE = 10;
const ACTIVITY_PER_PAGE = 5;

function buildPaginationUrl(baseParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(baseParams);
  params.set('page', page.toString());
  return `/teams?${params.toString()}`;
}

function getPageNumbers(currentPage: number, totalPages: number): (number | string)[] {
  const pages: (number | string)[] = [];
  const maxVisible = 7;

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    pages.push(1);

    if (currentPage <= 4) {
      for (let i = 2; i <= 5; i++) {
        pages.push(i);
      }
      pages.push('...');
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push('...');
      for (let i = totalPages - 4; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push('...');
      for (let i = currentPage - 1; i <= currentPage + 1; i++) {
        pages.push(i);
      }
      pages.push('...');
      pages.push(totalPages);
    }
  }

  return pages;
}

export default async function TeamsPage({ searchParams }: TeamsPageProps) {
  const awaitedSearchParams = await searchParams;
  const query = typeof awaitedSearchParams?.q === 'string' ? awaitedSearchParams.q.trim() : '';
  const sortBy =
    typeof awaitedSearchParams?.sortBy === 'string' ? awaitedSearchParams.sortBy : 'createdAt';
  const sortOrder =
    typeof awaitedSearchParams?.sortOrder === 'string' ? awaitedSearchParams.sortOrder : 'desc';
  const minMembers =
    typeof awaitedSearchParams?.minMembers === 'string'
      ? Number(awaitedSearchParams.minMembers)
      : undefined;
  const minServices =
    typeof awaitedSearchParams?.minServices === 'string'
      ? Number(awaitedSearchParams.minServices)
      : undefined;
  const page = Math.max(1, Number(awaitedSearchParams?.page) || 1);
  const skip = (page - 1) * TEAMS_PER_PAGE;

  const whereConditions: Prisma.TeamWhereInput[] = [];
  if (query) {
    whereConditions.push({
      OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
      ],
    });
  }
  if (minMembers !== undefined || minServices !== undefined) {
    const [memberCounts, serviceCounts] = await Promise.all([
      prisma.teamMember.groupBy({ by: ['teamId'], _count: { _all: true } }),
      prisma.service.groupBy({ by: ['teamId'], _count: { _all: true } }),
    ]);
    const memberCountByTeam = new Map(memberCounts.map(row => [row.teamId, row._count._all]));
    const serviceCountByTeam = new Map(
      serviceCounts.flatMap(row => (row.teamId ? [[row.teamId, row._count._all] as const] : []))
    );
    const candidateIds = new Set([...memberCountByTeam.keys(), ...serviceCountByTeam.keys()]);
    const eligibleIds = [...candidateIds].filter(
      teamId =>
        (minMembers === undefined || (memberCountByTeam.get(teamId) ?? 0) >= minMembers) &&
        (minServices === undefined || (serviceCountByTeam.get(teamId) ?? 0) >= minServices)
    );
    whereConditions.push({ id: { in: eligibleIds } });
  }
  const where: Prisma.TeamWhereInput = whereConditions.length > 0 ? { AND: whereConditions } : {};

  let orderBy: Prisma.TeamOrderByWithRelationInput | Prisma.TeamOrderByWithRelationInput[] = {
    createdAt: 'desc',
  };
  if (sortBy === 'createdAt') {
    orderBy = { createdAt: sortOrder as Prisma.SortOrder };
  } else if (sortBy === 'name') {
    orderBy = { name: sortOrder as Prisma.SortOrder };
  } else if (sortBy === 'memberCount') {
    orderBy = { members: { _count: sortOrder as Prisma.SortOrder } };
  } else if (sortBy === 'serviceCount') {
    orderBy = { services: { _count: sortOrder as Prisma.SortOrder } };
  }

  const [teams, adjustedTotalCount, users, ownerCounts] = await Promise.all([
    prisma.team.findMany({
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
                emailNotificationsEnabled: true,
                smsNotificationsEnabled: true,
                pushNotificationsEnabled: true,
                whatsappNotificationsEnabled: true,
                avatarUrl: true,
                gender: true,
              },
            },
          },
          orderBy: { role: 'asc' },
        },
        services: { select: { id: true, name: true } },
        _count: { select: { members: true, services: true } },
      },
      where,
      orderBy,
      skip,
      take: TEAMS_PER_PAGE,
    }),
    prisma.team.count({ where }),
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        avatarUrl: true,
        gender: true,
      },
      take: 500, // Limit users for the team member add dropdown to avoid unbounded memory
    }),
    prisma.teamMember.groupBy({
      by: ['teamId'],
      where: { role: 'OWNER' },
      _count: { _all: true },
    }),
  ]);

  const ownerCountByTeam = new Map<string, number>();
  for (const entry of ownerCounts) {
    ownerCountByTeam.set(entry.teamId, entry._count._all);
  }

  let permissions;
  try {
    permissions = await getUserPermissions();
  } catch (error) {
    logger.error('Error getting user permissions', { component: 'teams-page', error });
    permissions = {
      id: '',
      role: 'USER' as const,
      isAdmin: false,
      isAdminOrResponder: false,
      isResponderOrAbove: false,
    };
  }

  const canCreateTeam = permissions.isAdminOrResponder;
  const canUpdateTeam = permissions.isAdminOrResponder;
  const canDeleteTeam = permissions.isAdmin;
  const canManageMembers = permissions.isAdminOrResponder;

  const totalPages = Math.ceil(adjustedTotalCount / TEAMS_PER_PAGE);
  const pageNumbers = totalPages > 1 ? getPageNumbers(page, totalPages) : [];
  const baseParams = new URLSearchParams();
  if (query) baseParams.set('q', query);
  if (sortBy !== 'createdAt') baseParams.set('sortBy', sortBy);
  if (sortOrder !== 'desc') baseParams.set('sortOrder', sortOrder);
  if (minMembers !== undefined) baseParams.set('minMembers', minMembers.toString());
  if (minServices !== undefined) baseParams.set('minServices', minServices.toString());

  // Batch fetch all audit logs for all teams in a single query
  const teamIds = teams.map(t => t.id);
  let allAuditLogs: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  let auditLogCounts: { teamId: string; count: number }[] = [];

  if (teamIds.length > 0) {
    try {
      // Build OR conditions for all teams
      const orConditions = teamIds.flatMap(teamId => [
        { entityType: 'TEAM' as const, entityId: teamId },
        {
          entityType: 'TEAM_MEMBER' as const,
          entityId: { startsWith: `${teamId}:` },
        },
      ]);

      // Fetch logs - we fetch more than needed and group in memory
      allAuditLogs = await prisma.auditLog.findMany({
        where: { OR: orConditions },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              gender: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      // Count logs per team using aggregation
      const countResults = await prisma.auditLog.groupBy({
        by: ['entityType', 'entityId'],
        where: { OR: orConditions },
        _count: { _all: true },
      });

      // Aggregate counts by team
      const countByTeam = new Map<string, number>();
      for (const result of countResults) {
        let teamId: string | null = null;
        if (result.entityType === 'TEAM' && result.entityId) {
          teamId = result.entityId;
        } else if (result.entityType === 'TEAM_MEMBER' && result.entityId) {
          teamId = result.entityId.split(':')[0];
        }
        if (teamId) {
          countByTeam.set(teamId, (countByTeam.get(teamId) || 0) + result._count._all);
        }
      }
      auditLogCounts = teamIds.map(id => ({ teamId: id, count: countByTeam.get(id) || 0 }));
    } catch (error) {
      logger.error('Error fetching audit logs for teams', {
        component: 'teams-page',
        error,
      });
    }
  }

  // Group logs by team in memory
  const logsByTeam = new Map<string, typeof allAuditLogs>();
  for (const teamId of teamIds) {
    logsByTeam.set(teamId, []);
  }
  for (const log of allAuditLogs) {
    let teamId: string | null = null;
    if (log.entityType === 'TEAM' && log.entityId) {
      teamId = log.entityId;
    } else if (log.entityType === 'TEAM_MEMBER' && log.entityId) {
      teamId = log.entityId.split(':')[0];
    }
    if (teamId && logsByTeam.has(teamId)) {
      const teamLogs = logsByTeam.get(teamId)!;
      if (teamLogs.length < ACTIVITY_PER_PAGE) {
        teamLogs.push(log);
      }
    }
  }

  // Build teamsWithActivity from the grouped data
  const countMap = new Map(auditLogCounts.map(c => [c.teamId, c.count]));
  const teamsWithActivity = teams.map(team => ({
    team,
    activityLogs: logsByTeam.get(team.id) || [],
    activityTotal: countMap.get(team.id) || 0,
  }));

  // Calculate stats
  // Calculate stats (Note: since we moved to DB pagination, these stats now reflect the current page rather than all pages, except for total teams)
  const stats = {
    total: adjustedTotalCount,
    totalMembers: teams.reduce((sum, team) => sum + team._count.members, 0),
    totalServices: teams.reduce((sum, team) => sum + team._count.services, 0),
    avgMembersPerTeam:
      teams.length > 0
        ? Math.round(teams.reduce((sum, team) => sum + team._count.members, 0) / teams.length)
        : 0,
  };

  return (
    <div className="w-full px-4 py-6 space-y-6 [zoom:0.7]">
      {/* Header with Stats */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white rounded-lg p-4 md:p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 text-white">
              <Users className="h-6 w-6 md:h-8 md:w-8" />
              Teams
            </h1>
            <p className="text-xs md:text-sm opacity-90 mt-1 text-white">
              Manage team ownership, roles, and service coverage
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 w-full lg:w-auto">
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold">{stats.total}</div>
                <div className="text-[10px] md:text-xs opacity-90">Total Teams</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-blue-200">
                  {stats.totalMembers}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Members</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-green-200">
                  {stats.totalServices}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Services</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-purple-200">
                  {stats.avgMembersPerTeam}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Avg/Team</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Main Content */}
        <div className="xl:col-span-3 space-y-4 md:space-y-6">
          {/* Create Team Form */}
          {canCreateTeam ? (
            <Card id="create-team">
              <CardHeader>
                <CardTitle>Create New Team</CardTitle>
                <CardDescription>Organize responders and assign services</CardDescription>
              </CardHeader>
              <CardContent>
                <TeamCreateForm action={createTeam} />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-orange-200 bg-orange-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-900">
                  <AlertCircle className="h-5 w-5" />
                  Create Team - Access Restricted
                </CardTitle>
                <CardDescription className="text-orange-700">
                  You need Admin or Responder role to create teams
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {/* Teams List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Team Directory</CardTitle>
                  <CardDescription>
                    Showing {skip + 1}-{Math.min(skip + TEAMS_PER_PAGE, adjustedTotalCount)} of{' '}
                    {adjustedTotalCount} teams
                  </CardDescription>
                </div>
                <TeamSortDropdown />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {teams.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No teams found</h3>
                    <p className="text-sm text-muted-foreground">
                      {query || minMembers !== undefined || minServices !== undefined
                        ? 'Try adjusting your search criteria'
                        : 'Use the form above to create your first team'}
                    </p>
                  </div>
                ) : (
                  teamsWithActivity.map(({ team, activityLogs, activityTotal }) => {
                    const availableUsers = users.filter(
                      user =>
                        !team.members.some(member => member.userId === user.id) &&
                        user.status !== 'DISABLED'
                    );

                    const ownerCount = ownerCountByTeam.get(team.id) || 0;
                    const adminCount = team.members.filter(m => m.role === 'ADMIN').length;
                    const memberCount = team.members.length;
                    const isTeamOwner = team.members.some(
                      member => member.userId === permissions.id && member.role === 'OWNER'
                    );
                    const canManageNotifications =
                      permissions.isAdmin ||
                      isTeamOwner ||
                      (permissions.isAdminOrResponder &&
                        team.members.some(member => member.userId === permissions.id));
                    const canAssignOwnerAdmin = permissions.isAdmin || isTeamOwner;

                    return (
                      <TeamCard
                        key={team.id}
                        team={team}
                        teamId={team.id}
                        ownerCount={ownerCount}
                        adminCount={adminCount}
                        memberCount={memberCount}
                        availableUsers={availableUsers}
                        activityLogs={activityLogs}
                        activityTotal={activityTotal}
                        canUpdateTeam={canUpdateTeam}
                        canDeleteTeam={canDeleteTeam}
                        canManageMembers={canManageMembers}
                        canManageNotifications={canManageNotifications}
                        canAssignOwnerAdmin={canAssignOwnerAdmin}
                        updateTeam={updateTeam}
                        deleteTeam={deleteTeam}
                        addTeamMember={addTeamMember}
                        updateTeamMemberRole={updateTeamMemberRole}
                        updateTeamMemberNotifications={updateTeamMemberNotifications}
                        removeTeamMember={removeTeamMember}
                      />
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between mt-6 pt-6 border-t gap-4">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-1 flex-wrap justify-center">
                    <Link href={buildPaginationUrl(baseParams, 1)}>
                      <Button variant="outline" size="sm" disabled={page === 1}>
                        First
                      </Button>
                    </Link>
                    <Link href={buildPaginationUrl(baseParams, Math.max(1, page - 1))}>
                      <Button variant="outline" size="sm" disabled={page === 1}>
                        <span className="hidden sm:inline">Previous</span>
                        <span className="sm:hidden">Prev</span>
                      </Button>
                    </Link>

                    {pageNumbers.map((pageNum, index) => {
                      if (pageNum === '...') {
                        return (
                          <span
                            key={`ellipsis-${index}`}
                            className="px-2 flex items-center text-muted-foreground"
                          >
                            ...
                          </span>
                        );
                      }

                      const isActive = pageNum === page;
                      return (
                        <Link
                          key={pageNum}
                          href={buildPaginationUrl(baseParams, pageNum as number)}
                        >
                          <Button
                            variant={isActive ? 'default' : 'outline'}
                            size="sm"
                            className="min-w-[2.5rem]"
                          >
                            {String(pageNum)}
                          </Button>
                        </Link>
                      );
                    })}

                    <Link href={buildPaginationUrl(baseParams, Math.min(totalPages, page + 1))}>
                      <Button variant="outline" size="sm" disabled={page === totalPages}>
                        <span className="hidden sm:inline">Next</span>
                        <span className="sm:hidden">Next</span>
                      </Button>
                    </Link>
                    <Link href={buildPaginationUrl(baseParams, totalPages)}>
                      <Button variant="outline" size="sm" disabled={page === totalPages}>
                        Last
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 md:space-y-6">
          {/* Filters */}
          <TeamFilters />

          {/* Sort Options - Removed in favor of header dropdown */}

          {/* Quick Links */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/users">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Users className="h-4 w-4" />
                  View All Users
                </Button>
              </Link>
              <Link href="/services">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Shield className="h-4 w-4" />
                  Manage Services
                </Button>
              </Link>
              <Link href="/audit">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Audit Logs
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
