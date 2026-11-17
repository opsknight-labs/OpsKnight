import prisma from '@/lib/prisma';
import { getUserPermissions, getViewableTeamWhere } from '@/lib/rbac';
import { createTeam } from './actions';
import TeamDirectoryList from '@/components/teams/TeamDirectoryList';
import TeamCreateForm from '@/components/TeamCreateForm';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { PageHeader } from '@/components/patterns';
import { Users, Shield, ArrowRight, HelpCircle, UserCheck, ShieldAlert } from 'lucide-react';
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
  const createAction = canCreateTeam ? (
    <TeamCreateForm action={createTeam} canCreate={canCreateTeam} />
  ) : undefined;

  const resourceLinkClass =
    'flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const setupSteps = [
    {
      title: 'Assign a team lead',
      body: 'The lead owns the roster and can be targeted directly by escalation steps.',
    },
    {
      title: 'Build the responder roster',
      body: 'Add engineers with an explicit role: owner, admin or member.',
    },
    {
      title: 'Connect owned services',
      body: 'Services owned by the team route their incidents to it.',
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Teams"
        icon={Users}
        description="Team ownership, leads, responder rosters and service coverage."
        primaryAction={createAction}
        stats={[
          {
            label: 'Teams',
            value: allTeamsCount,
            icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Members',
            value: totalMembersCount,
            icon: <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Services',
            value: totalServicesCount,
            icon: <Shield className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-3">
          <TeamDirectoryList
            teams={teams}
            createAction={createAction}
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
        </div>

        <aside className="space-y-4" aria-label="Team guidance">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Setting up a team
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                {setupSteps.map((step, index) => (
                  <li key={step.title} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-muted-foreground"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{step.title}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Related</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-4 pb-4">
              <Link href="/users" className={resourceLinkClass}>
                <span className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Users
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
              <Link href="/services" className={resourceLinkClass}>
                <span className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Services
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
              <Link href="/policies" className={resourceLinkClass}>
                <span className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Escalation policies
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
