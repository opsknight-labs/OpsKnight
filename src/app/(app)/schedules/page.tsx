import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { createSchedule } from './actions';
import ScheduleDirectoryList from '@/components/schedules/ScheduleDirectoryList';
import ScheduleCreateForm from '@/components/ScheduleCreateForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import PageHeader from '@/components/patterns/PageHeader';
import {
  AlertTriangle,
  Calendar,
  Layers3,
  Users,
  CheckCircle2,
  Network,
  ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';

import { Prisma } from '@prisma/client';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import { requirePageAccess } from '@/lib/access/server';

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; q?: string; search?: string; status?: string }>;
}) {
  await requirePageAccess('/schedules');
  const params = await searchParams;
  const requestedPage = parsePageParam(params?.page);
  const searchQuery = (params?.q || params?.search || '').trim();
  const statusFilter = params?.status || 'all';

  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);

  const baseWhere = scheduleReadWhere(actor);
  const filterConditions: Prisma.OnCallScheduleWhereInput[] = [baseWhere];

  if (searchQuery) {
    filterConditions.push({
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { timeZone: { contains: searchQuery, mode: 'insensitive' } },
        {
          layers: {
            some: {
              users: {
                some: {
                  user: {
                    name: { contains: searchQuery, mode: 'insensitive' },
                  },
                },
              },
            },
          },
        },
      ],
    });
  }

  if (statusFilter === 'configured') {
    filterConditions.push({
      layers: { some: { users: { some: {} } } },
    });
  } else if (statusFilter === 'needs-setup') {
    filterConditions.push({
      NOT: { layers: { some: { users: { some: {} } } } },
    });
  }

  const where: Prisma.OnCallScheduleWhereInput =
    filterConditions.length === 1 ? baseWhere : { AND: filterConditions };

  const [
    allSchedulesCount,
    totalLayersCount,
    responderAgg,
    configuredSchedulesCount,
    needsSetupSchedulesCount,
    totalFilteredCount,
  ] = await Promise.all([
    prisma.onCallSchedule.count({ where: baseWhere }),
    prisma.onCallLayer.count({ where: { schedule: baseWhere } }),
    prisma.onCallLayerUser.findMany({
      where: { layer: { schedule: baseWhere }, user: { status: 'ACTIVE' } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.onCallSchedule.count({
      where: {
        AND: [baseWhere, { layers: { some: { users: { some: {} } } } }],
      },
    }),
    prisma.onCallSchedule.count({
      where: {
        AND: [baseWhere, { NOT: { layers: { some: { users: { some: {} } } } } }],
      },
    }),
    prisma.onCallSchedule.count({ where }),
  ]);

  const pagination = calculatePaginationBounds({
    totalItems: totalFilteredCount,
    page: requestedPage,
    pageSize: 50,
  });

  const schedules = await prisma.onCallSchedule.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
    include: {
      layers: {
        include: {
          users: {
            where: { user: { status: 'ACTIVE' } },
            select: {
              userId: true,
              position: true,
              user: {
                select: {
                  name: true,
                  avatarUrl: true,
                  gender: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const totalLayers = totalLayersCount;
  const totalUniqueResponders = responderAgg.length;
  const hasConfiguredResponders = totalUniqueResponders > 0;

  const canManageSchedules = permissions.isAdminOrResponder;

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Schedules"
        icon={Calendar}
        description="Rotation layers, shifts and overrides that decide who is on call."
        primaryAction={
          <ScheduleCreateForm action={createSchedule} canCreate={canManageSchedules} />
        }
        stats={[
          {
            label: 'Responders',
            value: totalUniqueResponders,
            icon: <Users className="h-3.5 w-3.5" />,
          },
          { label: 'Layers', value: totalLayers, icon: <Layers3 className="h-3.5 w-3.5" /> },
          {
            label: 'Status',
            value: hasConfiguredResponders ? 'Configured' : 'Needs setup',
            icon: hasConfiguredResponders ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
            ),
            valueClassName: hasConfiguredResponders ? 'text-emerald-300' : 'text-amber-300',
          },
        ]}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Schedules List with Live Search & Filters */}
        <div className="xl:col-span-3 space-y-4">
          <ScheduleDirectoryList
            schedules={schedules}
            pagination={{
              currentPage: pagination.page,
              totalPages: pagination.totalPages,
              totalItems: pagination.totalItems,
              itemsPerPage: pagination.pageSize,
            }}
            filterCounts={{
              total: allSchedulesCount,
              configured: configuredSchedulesCount,
              needsSetup: needsSetupSchedulesCount,
            }}
            currentSearch={params?.q ?? params?.search ?? ''}
            currentStatus={statusFilter}
          />
        </div>

        {/* Sidebar: Step Guide & Quick Links */}
        <aside className="space-y-4">
          {/* Clean Guidance Card */}
          <Card className="overflow-hidden border-border shadow-xs">
            <CardHeader className="border-b border-border px-4 py-3">
              <CardTitle className="text-sm font-semibold text-foreground">
                Setting up a schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-2xs font-semibold tabular-nums text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  1
                </span>
                <div>
                  <p className="font-semibold text-foreground">Rotation Layers</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    Configure shift lengths (12h, 24h, weekly) and rotation start times.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-2xs font-semibold tabular-nums text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  2
                </span>
                <div>
                  <p className="font-semibold text-foreground">Assign Responders</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    Add team members in rotation sequence with easy reordering.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-2xs font-semibold tabular-nums text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  3
                </span>
                <div>
                  <p className="font-semibold text-foreground">Link Escalation Policies</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    Attach schedules to policy levels to route alerts to active on-call engineers.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="overflow-hidden border-border shadow-xs">
            <CardHeader className="border-b border-border px-4 py-3">
              <CardTitle className="text-sm font-semibold text-foreground">Related</CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-between h-8 text-xs font-medium"
              >
                <Link href="/policies">
                  <span className="flex items-center gap-2">
                    <Network className="h-3.5 w-3.5 text-muted-foreground" />
                    Escalation Policies
                  </span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-between h-8 text-xs font-medium"
              >
                <Link href="/teams">
                  <span className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    Team Directory
                  </span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
