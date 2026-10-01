import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { createSchedule } from './actions';
import ScheduleDirectoryList from '@/components/schedules/ScheduleDirectoryList';
import ScheduleCreateForm from '@/components/ScheduleCreateForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import {
  Calendar,
  Layers3,
  Users,
  CheckCircle2,
  Sparkles,
  Network,
  ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';

import { Prisma } from '@prisma/client';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; q?: string; search?: string; status?: string }>;
} = {}) {
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
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      {/* Header with Glassmorphic Stats Capsule */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 text-zinc-100 shadow-xl ring-1 ring-white/5 md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-white border border-zinc-700/80 shadow-xs">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                On-call schedules
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                Schedules
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-300">
                Manage rotation layers, shifts, on-call responders, and coverage calendars.
              </p>
            </div>
          </div>

          {/* Frosted Glassmorphism 3-column stats capsule */}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1.5 backdrop-blur-xs shadow-xs lg:min-w-[340px]">
            <div className="min-w-0 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Responders
              </p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-bold text-white">
                <Users className="h-3.5 w-3.5" /> {totalUniqueResponders}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border-x border-zinc-800/80 px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Layers
              </p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-bold text-white">
                <Layers3 className="h-3.5 w-3.5" /> {totalLayers}
              </p>
            </div>
            <div className="min-w-0 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Status
              </p>
              <p
                className={`mt-1 flex items-center justify-center gap-1.5 text-sm font-bold ${
                  hasConfiguredResponders ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {hasConfiguredResponders ? 'Configured' : 'Needs setup'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Top Action: Create Schedule Dashed Expander */}
      <ScheduleCreateForm action={createSchedule} canCreate={canManageSchedules} />

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
            currentSearch={searchQuery}
            currentStatus={statusFilter}
          />
        </div>

        {/* Sidebar: Step Guide & Quick Links */}
        <aside className="space-y-4">
          {/* Clean Guidance Card */}
          <Card className="overflow-hidden border-border/70 shadow-xs">
            <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Sparkles className="h-3 w-3" />
                </div>
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Schedule Lifecycle
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  1
                </span>
                <div>
                  <p className="font-semibold text-foreground">Rotation Layers</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Configure shift lengths (12h, 24h, weekly) and rotation start times.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  2
                </span>
                <div>
                  <p className="font-semibold text-foreground">Assign Responders</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Add team members in rotation sequence with easy reordering.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  3
                </span>
                <div>
                  <p className="font-semibold text-foreground">Link Escalation Policies</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Attach schedules to policy levels to route alerts to active on-call engineers.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="overflow-hidden border-border/70 shadow-xs">
            <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quick Links
              </CardTitle>
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
