import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { createSchedule } from './actions';
import ScheduleDirectoryList from '@/components/schedules/ScheduleDirectoryList';
import ScheduleCreateForm from '@/components/ScheduleCreateForm';
import { Calendar, Layers3, Users, CheckCircle2 } from 'lucide-react';

import { Prisma } from '@prisma/client';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import { requirePageAccess } from '@/lib/access/server';
import { summarizeScheduleOnCall } from '@/components/schedules/schedule-oncall-summary';
import type { LayerRestrictions } from '@/lib/oncall';

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

  // On call now / next handoff, from the same block engine as the detail page.
  const now = new Date();
  const summaryWindowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const overrides = schedules.length
    ? await prisma.onCallOverride.findMany({
        where: {
          scheduleId: { in: schedules.map(s => s.id) },
          start: { lt: summaryWindowEnd },
          end: { gt: now },
          user: { status: 'ACTIVE' },
        },
        select: {
          id: true,
          scheduleId: true,
          start: true,
          end: true,
          userId: true,
          replacesUserId: true,
          user: { select: { name: true, avatarUrl: true, gender: true } },
        },
      })
    : [];
  const schedulesWithOnCall = schedules.map(schedule => ({
    ...schedule,
    ...summarizeScheduleOnCall(
      {
        timeZone: schedule.timeZone,
        layers: schedule.layers.map(layer => ({
          ...layer,
          restrictions: layer.restrictions as LayerRestrictions | null,
        })),
      },
      overrides.filter(o => o.scheduleId === schedule.id),
      now
    ),
  }));

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

      <ScheduleDirectoryList
        schedules={schedulesWithOnCall}
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
    </main>
  );
}
