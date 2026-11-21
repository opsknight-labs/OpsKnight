import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { countOpenInsightsForScopes } from '@/lib/intelligence/ops-insights/view';
import { enabledOpsInsightAreas } from '@/lib/intelligence/ops-insights/contract';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import MyOnCallLoadCard from '@/components/schedules/MyOnCallLoadCard';
import { createSchedule } from './actions';
import ScheduleDirectoryList from '@/components/schedules/ScheduleDirectoryList';
import ScheduleCreateForm from '@/components/ScheduleCreateForm';
import { Calendar, Layers3, Users, CheckCircle2 } from 'lucide-react';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';

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

  const [permissions, actor, onCallInsightsOn] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
    getIntelligenceSettings()
      .then(settings => enabledOpsInsightAreas(settings).includes('onCall'))
      .catch(() => false),
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
  // Badges are optional: a failed read just hides them.
  const insightCounts = Object.fromEntries(
    await countOpenInsightsForScopes(
      actor,
      'SCHEDULE',
      schedules.map(schedule => schedule.id)
    ).catch(() => new Map())
  );

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
      <DetailHeroBanner
        tag="On-call schedules"
        title="Schedules"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Calendar className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Manage rotation layers, shifts, on-call responders, and coverage calendars.
          </p>
        }
        stats={[
          {
            label: 'Responders',
            value: totalUniqueResponders,
            icon: <Users className="h-3.5 w-3.5" />,
          },
          {
            label: 'Layers',
            value: totalLayers,
            icon: <Layers3 className="h-3.5 w-3.5" />,
          },
          {
            label: 'Status',
            value: hasConfiguredResponders ? 'Configured' : 'Needs setup',
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            valueClassName: hasConfiguredResponders ? 'text-emerald-200' : 'text-amber-200',
          },
        ]}
      />

      {/* Top Action: Create Schedule Dashed Expander */}
      <ScheduleCreateForm action={createSchedule} canCreate={canManageSchedules} />

      {onCallInsightsOn && (
        <Suspense fallback={null}>
          <MyOnCallLoadCard userId={actor.id} />
        </Suspense>
      )}
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
        insightCounts={insightCounts}
      />
    </main>
  );
}
