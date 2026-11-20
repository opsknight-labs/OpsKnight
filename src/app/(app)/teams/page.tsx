import prisma from '@/lib/prisma';
import { getUserPermissions, getViewableTeamWhere } from '@/lib/rbac';
import { createTeam } from './actions';
import TeamDirectoryList from '@/components/teams/TeamDirectoryList';
import TeamCreateForm from '@/components/TeamCreateForm';
import { AlertTriangle, Shield, UserCheck, Users } from 'lucide-react';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';

import { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/access/server';

export default async function TeamsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; q?: string; search?: string; status?: string }>;
}) {
  await requirePageAccess('/teams');
  const params = await searchParams;
  const requestedPage = parsePageParam(params?.page);
  const searchQuery = (params?.q || params?.search || '').trim();
  const statusFilter = params?.status || 'all';
  const teamScope = await getViewableTeamWhere();

  const filterConditions: Prisma.TeamWhereInput[] = [teamScope];

  if (searchQuery) {
    filterConditions.push({
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { description: { contains: searchQuery, mode: 'insensitive' } },
        { teamLead: { name: { contains: searchQuery, mode: 'insensitive' } } },
        {
          members: {
            some: {
              user: {
                OR: [
                  { name: { contains: searchQuery, mode: 'insensitive' } },
                  { email: { contains: searchQuery, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
        {
          services: {
            some: {
              name: { contains: searchQuery, mode: 'insensitive' },
            },
          },
        },
      ],
    });
  }

  if (statusFilter === 'configured') {
    filterConditions.push({
      AND: [{ teamLeadId: { not: null } }, { members: { some: {} } }],
    });
  } else if (statusFilter === 'needs-lead') {
    filterConditions.push({ teamLeadId: null });
  } else if (statusFilter === 'needs-services') {
    filterConditions.push({ services: { none: {} } });
  }

  const where: Prisma.TeamWhereInput =
    filterConditions.length === 1 ? teamScope : { AND: filterConditions };

  const [
    allTeamsCount,
    totalMembersCount,
    totalServicesCount,
    configuredTeamsCount,
    needsLeadTeamsCount,
    totalFilteredCount,
    permissions,
  ] = await Promise.all([
    prisma.team.count({ where: teamScope }),
    prisma.teamMember.count({ where: { team: teamScope } }),
    prisma.service.count({ where: { team: teamScope } }),
    prisma.team.count({
      where: {
        AND: [teamScope, { teamLeadId: { not: null } }, { members: { some: {} } }],
      },
    }),
    prisma.team.count({
      where: {
        AND: [teamScope, { teamLeadId: null }],
      },
    }),
    prisma.team.count({ where }),
    getUserPermissions(),
  ]);

  const pagination = calculatePaginationBounds({
    totalItems: totalFilteredCount,
    page: requestedPage,
    pageSize: 50,
  });

  const teams = await prisma.team.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
    include: {
      teamLead: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          gender: true,
        },
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              gender: true,
            },
          },
        },
        orderBy: { role: 'asc' },
      },
      services: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          members: true,
          services: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const canCreateTeam = permissions.isAdminOrResponder;

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="Organization & Ownership"
        title="Teams"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Users className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Manage team ownership, lead assignments, responder rosters, and service coverage.
          </p>
        }
        stats={[
          {
            label: 'Members',
            value: totalMembersCount,
            icon: <UserCheck className="h-3.5 w-3.5" />,
          },
          {
            label: 'Services',
            value: totalServicesCount,
            icon: <Shield className="h-3.5 w-3.5" />,
          },
          {
            label: 'Needs lead',
            value: needsLeadTeamsCount,
            icon: <AlertTriangle className="h-3.5 w-3.5" />,
            valueClassName: needsLeadTeamsCount > 0 ? 'text-amber-200' : undefined,
          },
        ]}
      />

      {/* Top Action: Create Team Dashed Expander */}
      <TeamCreateForm action={createTeam} canCreate={canCreateTeam} />

      <TeamDirectoryList
        teams={teams}
        pagination={{
          currentPage: pagination.page,
          totalPages: pagination.totalPages,
          totalItems: pagination.totalItems,
          itemsPerPage: pagination.pageSize,
        }}
        filterCounts={{
          total: allTeamsCount,
          configured: configuredTeamsCount,
          needsLead: needsLeadTeamsCount,
        }}
        currentSearch={searchQuery}
        currentStatus={statusFilter}
      />
    </main>
  );
}
