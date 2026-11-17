import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Prisma, Role, UserStatus } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import {
  addUser,
  addUserToTeam,
  bulkUpdateUsers,
  deactivateUser,
  deleteUser,
  generateInvite,
  getUserDependencyReport,
  reactivateUser,
  updateUserRole,
} from './actions';
import InviteUserModal from '@/components/users/InviteUserModal';
import UserFilters from '@/components/users/UserFilters';
import UserList from '@/components/users/UserList';
import UserSortDropdown from '@/components/users/UserSortDropdown';
import { Button } from '@/components/ui/shadcn/button';
import { PageHeader } from '@/components/patterns';
import { Users, UserCheck, UserPlus, UserX } from 'lucide-react';
import { isAppRole } from '@/lib/authorization';
import { assertCanListUsers } from '@/lib/rbac';
import {
  parsePageParam,
  calculatePaginationBounds,
  formatPaginationSummary,
  parseEnumValue,
} from '@/lib/pagination-parser';
import { requirePageAccess } from '@/lib/access/server';
import { RestrictedAction } from '@/components/access/AccessProvider';

export const dynamic = 'force-dynamic';

const USERS_PER_PAGE = 20;

type UsersPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

function buildPaginationUrl(baseParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(baseParams);
  params.set('page', page.toString());
  return `/users?${params.toString()}`;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  await requirePageAccess('/users');
  const awaitedSearchParams = await searchParams;
  const query = typeof awaitedSearchParams?.q === 'string' ? awaitedSearchParams.q.trim() : '';
  const statusFilter = parseEnumValue(
    awaitedSearchParams?.status,
    ['INVITED', 'ACTIVE', 'DISABLED'] as const,
    undefined
  );
  const requestedRole =
    typeof awaitedSearchParams?.role === 'string' ? awaitedSearchParams.role : '';
  const roleFilter = isAppRole(requestedRole) ? requestedRole : '';
  const teamFilter =
    typeof awaitedSearchParams?.teamId === 'string' ? awaitedSearchParams.teamId : '';
  const sortBy =
    typeof awaitedSearchParams?.sortBy === 'string' ? awaitedSearchParams.sortBy : 'createdAt';
  const sortOrder =
    typeof awaitedSearchParams?.sortOrder === 'string' ? awaitedSearchParams.sortOrder : 'desc';
  const requestedPage = parsePageParam(awaitedSearchParams?.page);

  // Security & Initialization Checks
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login?callbackUrl=/users');
  }
  await assertCanListUsers();

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect('/setup');
  }

  const where: Prisma.UserWhereInput = {
    AND: [
      query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {},
      statusFilter ? { status: statusFilter as UserStatus } : {},
      roleFilter ? { role: roleFilter as Role } : {},
      teamFilter
        ? {
            teamMemberships: {
              some: {
                teamId: teamFilter,
              },
            },
          }
        : {},
    ],
  };

  const [totalCount, teams] = await Promise.all([
    prisma.user.count({ where }),
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const pagination = calculatePaginationBounds({
    totalItems: totalCount,
    page: requestedPage,
    pageSize: USERS_PER_PAGE,
  });
  const page = pagination.page;
  const totalPages = pagination.totalPages;

  const { mode: authenticationMode } = await getAuthenticationPolicy();
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      avatarUrl: true,
      gender: true,
      jobTitle: true,
      department: true,
      createdAt: true,
      roleSource: true,
      teamMemberships: {
        include: {
          team: true,
        },
      },
    },
    where,
    orderBy:
      sortBy === 'name'
        ? { name: sortOrder as 'asc' | 'desc' }
        : sortBy === 'email'
          ? { email: sortOrder as 'asc' | 'desc' }
          : sortBy === 'status'
            ? { status: sortOrder as 'asc' | 'desc' }
            : { createdAt: sortOrder as 'asc' | 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  // Get stats
  const stats = {
    total: totalCount,
    active: 0,
    invited: 0,
    disabled: 0,
  };

  if (query || statusFilter || roleFilter || teamFilter) {
    const [activeCount, invitedCount, disabledCount] = await Promise.all([
      prisma.user.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.user.count({ where: { ...where, status: 'INVITED' } }),
      prisma.user.count({ where: { ...where, status: 'DISABLED' } }),
    ]);
    stats.active = activeCount;
    stats.invited = invitedCount;
    stats.disabled = disabledCount;
  } else {
    const [totalStats] = await Promise.all([
      prisma.user.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    stats.active = totalStats.find(s => s.status === 'ACTIVE')?._count._all || 0;
    stats.invited = totalStats.find(s => s.status === 'INVITED')?._count._all || 0;
    stats.disabled = totalStats.find(s => s.status === 'DISABLED')?._count._all || 0;
  }

  const currentUserEmail = session?.user?.email;
  const currentUser = currentUserEmail
    ? await prisma.user.findUnique({
        where: { email: currentUserEmail },
        select: { id: true, role: true },
      })
    : null;
  const currentUserId = currentUser?.id || '';
  const currentUserRole = (currentUser?.role as Role) || 'USER';
  const isAdmin = currentUserRole === 'ADMIN';

  const baseParams = new URLSearchParams();
  if (query) baseParams.set('q', query);
  if (statusFilter) baseParams.set('status', statusFilter);
  if (roleFilter) baseParams.set('role', roleFilter);
  if (teamFilter) baseParams.set('teamId', teamFilter);
  if (sortBy !== 'createdAt') baseParams.set('sortBy', sortBy);
  if (sortOrder !== 'desc') baseParams.set('sortOrder', sortOrder);

  const hasFilters = Boolean(query || statusFilter || roleFilter || teamFilter);
  const inviteAction = (
    <RestrictedAction allowed={isAdmin} anyOf="admin.manage">
      <InviteUserModal action={addUser} disabled={!isAdmin} label="Invite User" />
    </RestrictedAction>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Users & Responders"
        icon={Users}
        description="Organization members, their roles and team memberships, and who can be paged."
        primaryAction={inviteAction}
        stats={[
          {
            label: 'Users',
            value: stats.total,
            icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Active',
            value: stats.active,
            icon: <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Invited',
            value: stats.invited,
            icon: <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Disabled',
            value: stats.disabled,
            icon: <UserX className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <UserFilters teams={teams} actions={<UserSortDropdown />} />

      <section aria-label="User directory" className="space-y-4">
        <UserList
          users={users}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          teams={teams}
          hasFilters={hasFilters}
          summary={formatPaginationSummary(
            pagination.startItem,
            pagination.endItem,
            totalCount,
            'users'
          )}
          emptyAction={inviteAction}
          passwordResetAvailable={authenticationMode !== 'SSO_REQUIRED'}
          updateUserRole={updateUserRole}
          addUserToTeam={addUserToTeam}
          deactivateUser={deactivateUser}
          reactivateUser={reactivateUser}
          deleteUser={deleteUser}
          generateInvite={generateInvite}
          getUserDependencyReport={getUserDependencyReport}
          bulkUpdateUsers={bulkUpdateUsers}
        />

        {totalPages > 1 && (
          <nav
            aria-label="Pagination"
            className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row"
          >
            <p className="text-sm tabular-nums text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                { label: 'First', target: 1, disabled: page === 1 },
                { label: 'Previous', target: Math.max(1, page - 1), disabled: page === 1 },
                {
                  label: 'Next',
                  target: Math.min(totalPages, page + 1),
                  disabled: page === totalPages,
                },
                { label: 'Last', target: totalPages, disabled: page === totalPages },
              ].map(item =>
                item.disabled ? (
                  <Button key={item.label} variant="outline" size="sm" disabled>
                    {item.label}
                  </Button>
                ) : (
                  <Button key={item.label} asChild variant="outline" size="sm">
                    <Link href={buildPaginationUrl(baseParams, item.target)}>{item.label}</Link>
                  </Button>
                )
              )}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
