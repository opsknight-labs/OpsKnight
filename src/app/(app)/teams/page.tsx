import prisma from '@/lib/prisma';
import { getUserPermissions, getViewableTeamWhere } from '@/lib/rbac';
import { createTeam } from './actions';
import TeamDirectoryList from '@/components/teams/TeamDirectoryList';
import TeamCreateForm from '@/components/TeamCreateForm';
import { AlertTriangle, Shield, UserCheck, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
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
      {/* Header Banner with Glassmorphic Stats Capsule */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 text-zinc-100 shadow-xl ring-1 ring-white/5 md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-white border border-zinc-700/80 shadow-xs">
              <Users className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Organization &amp; Ownership
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                Teams
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-300">
                Manage team ownership, lead assignments, responder rosters, and service coverage.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1.5 text-center shadow-xs lg:min-w-[330px]">
            {[
              { label: 'Members', value: totalMembersCount, icon: UserCheck, warn: false },
              { label: 'Services', value: totalServicesCount, icon: Shield, warn: false },
              {
                label: 'Needs lead',
                value: needsLeadTeamsCount,
                icon: AlertTriangle,
                warn: needsLeadTeamsCount > 0,
              },
            ].map(stat => (
              <div key={stat.label} className="min-w-0 rounded-lg px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {stat.label}
                </dt>
                <dd
                  className={cn(
                    'mt-1 flex items-center justify-center gap-1.5 text-sm font-bold',
                    stat.warn ? 'text-amber-300' : 'text-white'
                  )}
                >
                  <stat.icon className="h-3.5 w-3.5" aria-hidden="true" /> {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

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
