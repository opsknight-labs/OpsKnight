import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Prisma, Role, UserStatus, AuditEntityType } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import {
  addUser,
  addUserToTeam,
  deactivateUser,
  deleteUser,
  generateInvite,
  reactivateUser,
  updateUserRole,
} from './actions';
import UserCreateForm from '@/components/UserCreateForm';
import UserFilters from '@/components/users/UserFilters';
import UserList from '@/components/users/UserList';
import UserSortDropdown from '@/components/users/UserSortDropdown';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Badge } from '@/components/ui/shadcn/badge';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Users, UserCheck, UserPlus, UserX, ArrowUpDown } from 'lucide-react';
import { isAppRole } from '@/lib/authorization';
import { assertAdmin } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const USERS_PER_PAGE = 20;
const HISTORY_PER_PAGE = 20;

type UsersPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

function buildPaginationUrl(baseParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(baseParams);
  params.set('page', page.toString());
  return `/users?${params.toString()}`;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const awaitedSearchParams = await searchParams;
  const query = typeof awaitedSearchParams?.q === 'string' ? awaitedSearchParams.q.trim() : '';
  const statusFilter =
    typeof awaitedSearchParams?.status === 'string' ? awaitedSearchParams.status : '';
  const requestedRole =
    typeof awaitedSearchParams?.role === 'string' ? awaitedSearchParams.role : '';
  const roleFilter = isAppRole(requestedRole) ? requestedRole : '';
  const teamFilter =
    typeof awaitedSearchParams?.teamId === 'string' ? awaitedSearchParams.teamId : '';
  const sortBy =
    typeof awaitedSearchParams?.sortBy === 'string' ? awaitedSearchParams.sortBy : 'createdAt';
  const sortOrder =
    typeof awaitedSearchParams?.sortOrder === 'string' ? awaitedSearchParams.sortOrder : 'desc';
  const page = Math.max(1, Number(awaitedSearchParams?.page) || 1);
  const historyPage = Math.max(1, Number(awaitedSearchParams?.historyPage) || 1);
  const skip = (page - 1) * USERS_PER_PAGE;
  const historySkip = (historyPage - 1) * HISTORY_PER_PAGE;

  // Security & Initialization Checks
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login?callbackUrl=/users');
  }
  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect('/setup');
  }

  const where: any = {
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

  const auditLogWhere: Prisma.AuditLogWhereInput = {
    entityType: 'USER' as AuditEntityType,
  };

  const [users, totalCount, auditLogs, auditLogTotal, teams] = await Promise.all([
    prisma.user.findMany({
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
      skip,
      take: USERS_PER_PAGE,
    }),
    prisma.user.count({ where }),
    prisma.auditLog.findMany({
      include: {
        actor: true,
      },
      where: auditLogWhere,
      orderBy: { createdAt: 'desc' },
      skip: historySkip,
      take: HISTORY_PER_PAGE,
    }),
    prisma.auditLog.count({ where: auditLogWhere }),
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
  ]);

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

  const totalPages = Math.ceil(totalCount / USERS_PER_PAGE);
  const historyTotalPages = Math.ceil(auditLogTotal / HISTORY_PER_PAGE);

  const currentUserEmail = session?.user?.email;
  const currentUser = currentUserEmail
    ? await prisma.user.findUnique({
        where: { email: currentUserEmail },
        select: { id: true, role: true, timeZone: true },
      })
    : null;
  const currentUserId = currentUser?.id || '';
  const currentUserRole = (currentUser?.role as Role) || 'USER';
  const isAdmin = currentUserRole === 'ADMIN';

  const userTimeZone = getUserTimeZone(currentUser ?? undefined);

  const baseParams = new URLSearchParams();
  if (query) baseParams.set('q', query);
  if (statusFilter) baseParams.set('status', statusFilter);
  if (roleFilter) baseParams.set('role', roleFilter);
  if (teamFilter) baseParams.set('teamId', teamFilter);
  if (sortBy !== 'createdAt') baseParams.set('sortBy', sortBy);
  if (sortOrder !== 'desc') baseParams.set('sortOrder', sortOrder);

  const historyBaseParams = new URLSearchParams();
  if (query) historyBaseParams.set('q', query);
  if (statusFilter) historyBaseParams.set('status', statusFilter);
  if (roleFilter) historyBaseParams.set('role', roleFilter);
  if (teamFilter) historyBaseParams.set('teamId', teamFilter);
  if (page > 1) historyBaseParams.set('page', page.toString());
  if (sortBy !== 'createdAt') historyBaseParams.set('sortBy', sortBy);
  if (sortOrder !== 'desc') historyBaseParams.set('sortOrder', sortOrder);

  function buildHistoryPaginationUrl(pageNum: number): string {
    const params = new URLSearchParams(historyBaseParams);
    params.set('historyPage', pageNum.toString());
    return `/users?${params.toString()}`;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header with 4-Stat Capsule */}
      <DetailHeroBanner
        tag="Team & Member Access"
        title="Users & Responders"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Users className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Manage organization members, assign operational roles, configure paging channels, and
            oversee on-call responder access.
          </p>
        }
        stats={[
          {
            label: 'Total Users',
            value: stats.total,
            icon: <Users className="h-3.5 w-3.5" />,
          },
          {
            label: 'Active',
            value: stats.active,
            icon: <UserCheck className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: stats.active > 0 ? 'text-emerald-200' : undefined,
          },
          {
            label: 'Invited',
            value: stats.invited,
            icon: <UserPlus className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: stats.invited > 0 ? 'text-amber-200' : undefined,
          },
          {
            label: 'Disabled',
            value: stats.disabled,
            icon: <UserX className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: stats.disabled > 0 ? 'text-rose-200' : undefined,
          },
        ]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-6">
        {/* Main Content */}
        <div className="xl:col-span-2 space-y-4 md:space-y-6">
          {/* Filters */}
          <UserFilters teams={teams} />

          {/* User List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>User Directory</CardTitle>
                  <CardDescription>
                    Showing {skip + 1}-{Math.min(skip + USERS_PER_PAGE, totalCount)} of {totalCount}{' '}
                    users
                  </CardDescription>
                </div>
                <UserSortDropdown />
              </div>
            </CardHeader>
            <CardContent>
              <UserList
                users={users}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                teams={teams}
                updateUserRole={updateUserRole}
                addUserToTeam={addUserToTeam}
                deactivateUser={deactivateUser}
                reactivateUser={reactivateUser}
                deleteUser={deleteUser}
                generateInvite={generateInvite as any}
              />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between mt-6 pt-6 border-t gap-4">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
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
                    <Link href={buildPaginationUrl(baseParams, Math.min(totalPages, page + 1))}>
                      <Button variant="outline" size="sm" disabled={page === totalPages}>
                        Next
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
          {/* Invite New User */}
          <Card>
            <CardHeader className="p-5 pb-2">
              <CardTitle>Invite New User</CardTitle>
              <CardDescription>Add a new team member</CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <UserCreateForm action={addUser} disabled={!isAdmin} />
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card>
            <CardHeader className="p-5 pb-2">
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Showing {historySkip + 1}-{Math.min(historySkip + HISTORY_PER_PAGE, auditLogTotal)}{' '}
                of {auditLogTotal} entries
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="space-y-3">
                {auditLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>
                ) : (
                  auditLogs.map(log => (
                    <div key={log.id} className="p-3 bg-muted/50 rounded-lg border">
                      <div className="font-medium text-sm">{log.action}</div>
                      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                        <span>{log.actor?.name || 'System'}</span>
                        <span>
                          {formatDateTime(log.createdAt, userTimeZone, { format: 'datetime' })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* History Pagination */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-xs text-muted-foreground">
                    Page {historyPage} of {historyTotalPages}
                  </div>
                  <div className="flex gap-1">
                    <Link href={buildHistoryPaginationUrl(Math.max(1, historyPage - 1))}>
                      <Button variant="outline" size="sm" disabled={historyPage === 1}>
                        Prev
                      </Button>
                    </Link>
                    <Link
                      href={buildHistoryPaginationUrl(Math.min(historyTotalPages, historyPage + 1))}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyPage === historyTotalPages}
                      >
                        Next
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
