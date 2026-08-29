import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertCanViewSchedule } from '@/lib/rbac';
import type { ScheduleUICapabilities } from '@/lib/schedules/capabilities';
import { buildScheduleBlocks, getFinalScheduleBlocks } from '@/lib/oncall';
import {
  addDaysToDateKey,
  formatDateForInput,
  formatDateKeyInTimeZone,
  formatDateTime,
  startOfDayFromDateKey,
} from '@/lib/timezone';
import { buildScheduleDetailViewModel } from '@/lib/schedules/detail-view-model';
import {
  addLayerUser,
  createLayer,
  createOverride,
  deleteLayer,
  deleteOverride,
  moveLayerUser,
  moveLayerPrecedence,
  removeLayerUser,
  updateLayer,
  updateSchedule,
} from '../actions';
import ScheduleCalendar from '@/components/ScheduleCalendar';
import ScheduleTimeline from '@/components/ScheduleTimeline';
import CoverageTimeline from '@/components/CoverageTimeline';
import CurrentCoverageDisplay from '@/components/CurrentCoverageDisplay';
import LayerCard from '@/components/LayerCard';
import LayerCreateForm from '@/components/LayerCreateForm';
import OverrideForm from '@/components/OverrideForm';
import OverrideList from '@/components/OverrideList';
import ScheduleEditForm from '@/components/ScheduleEditForm';
import ScheduleTimezoneNotice from '@/components/ScheduleTimezoneNotice';
import ScheduleDetailTabs from '@/components/schedules/ScheduleDetailTabs';
import ScheduleCoverageExplorer from '@/components/schedules/ScheduleCoverageExplorer';
import ScheduleCoveragePreview from '@/components/schedules/ScheduleCoveragePreview';
import ScheduleActivityFeed from '@/components/schedules/ScheduleActivityFeed';
import ScheduleHealthCheck from '@/components/ScheduleHealthCheck';
import ScheduleLinkedPolicies from '@/components/schedules/ScheduleLinkedPolicies';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock3,
  Globe2,
  Info,
  Layers3,
  ShieldAlert,
  Users,
} from 'lucide-react';

export const revalidate = 0;

export default async function ScheduleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ history?: string; tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const now = new Date();
  const historyPageSize = 8;
  const historyPage = Math.max(1, Number(query?.history ?? 1) || 1);

  let capabilities: ScheduleUICapabilities;
  let currentUser: Awaited<ReturnType<typeof assertCanViewSchedule>>['user'];
  try {
    ({ user: currentUser, capabilities } = await assertCanViewSchedule(id));
  } catch {
    notFound();
  }
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      timeZone: true,
      layers: {
        select: {
          id: true,
          name: true,
          start: true,
          end: true,
          rotationLengthHours: true,
          shiftLengthHours: true,
          restrictions: true,
          priority: true,
          users: {
            where: { user: { status: 'ACTIVE' } },
            select: {
              userId: true,
              position: true,
              user: { select: { name: true, avatarUrl: true, gender: true } },
            },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!schedule) notFound();

  const todayKey = formatDateKeyInTimeZone(now, schedule.timeZone);
  const coverageRangeStart = startOfDayFromDateKey(
    addDaysToDateKey(todayKey, -35),
    schedule.timeZone
  );
  const coverageRangeEnd = startOfDayFromDateKey(addDaysToDateKey(todayKey, 95), schedule.timeZone);

  const canMutate = capabilities.canManageRotation || capabilities.canCreateOverride;
  const [
    users,
    overridesInRange,
    currentAndFutureOverrides,
    historyCount,
    historyOverrides,
    auditLogs,
    linkedRules,
  ] = await Promise.all([
    canMutate
      ? prisma.user.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            gender: true,
          },
          orderBy: [{ name: 'asc' }, { email: 'asc' }],
        })
      : Promise.resolve([]),
    prisma.onCallOverride.findMany({
      where: {
        scheduleId: id,
        start: { lt: coverageRangeEnd },
        end: { gt: coverageRangeStart },
        user: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        start: true,
        end: true,
        userId: true,
        replacesUserId: true,
        user: { select: { name: true, avatarUrl: true, gender: true } },
        replacesUser: { select: { name: true } },
      },
    }),
    prisma.onCallOverride.findMany({
      where: { scheduleId: id, end: { gt: now }, user: { status: 'ACTIVE' } },
      select: {
        id: true,
        start: true,
        end: true,
        userId: true,
        replacesUserId: true,
        user: { select: { name: true, avatarUrl: true, gender: true } },
        replacesUser: { select: { name: true } },
      },
      orderBy: { start: 'asc' },
      take: 100,
    }),
    prisma.onCallOverride.count({ where: { scheduleId: id, end: { lte: now } } }),
    prisma.onCallOverride.findMany({
      where: { scheduleId: id, end: { lte: now } },
      select: {
        id: true,
        start: true,
        end: true,
        userId: true,
        replacesUserId: true,
        user: { select: { name: true, avatarUrl: true, gender: true } },
        replacesUser: { select: { name: true } },
      },
      orderBy: { end: 'desc' },
      skip: (historyPage - 1) * historyPageSize,
      take: historyPageSize,
    }),
    prisma.auditLog.findMany({
      where: { entityType: 'SCHEDULE', entityId: id },
      select: {
        id: true,
        action: true,
        actorName: true,
        actorEmail: true,
        details: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            gender: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    prisma.escalationRule.findMany({
      where: { targetScheduleId: id },
      include: {
        policy: {
          select: {
            id: true,
            name: true,
            services: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const typedLayers = schedule.layers.map(layer => ({
    ...layer,
    restrictions: layer.restrictions as {
      daysOfWeek?: number[];
      startHour?: number;
      endHour?: number;
    } | null,
  }));
  const layerPriorities = new Map(schedule.layers.map(layer => [layer.id, layer.priority ?? 0]));
  const scheduleBlocks = buildScheduleBlocks(
    typedLayers,
    overridesInRange,
    coverageRangeStart,
    coverageRangeEnd,
    schedule.timeZone
  );
  const effectiveBlocks = getFinalScheduleBlocks(scheduleBlocks, layerPriorities);
  const viewModel = buildScheduleDetailViewModel({
    now,
    finalCoverageBlocks: effectiveBlocks,
    overrides: currentAndFutureOverrides,
    layerCount: schedule.layers.length,
    participantIds: schedule.layers.flatMap(layer => layer.users.map(user => user.userId)),
  });

  const activeOverrideIds = new Set(viewModel.activeOverrides.map(override => override.id));
  const upcomingOverrideIds = new Set(viewModel.upcomingOverrides.map(override => override.id));
  const activeOverrides = currentAndFutureOverrides.filter(override =>
    activeOverrideIds.has(override.id)
  );
  const upcomingOverrides = currentAndFutureOverrides.filter(override =>
    upcomingOverrideIds.has(override.id)
  );
  const historyTotalPages = Math.max(1, Math.ceil(historyCount / historyPageSize));
  const assignedUserIds = new Set(
    schedule.layers.flatMap(layer => layer.users.map(member => member.userId))
  );
  const assignableUsers = users.filter(user => !assignedUserIds.has(user.id));
  const configuredLayerCount = schedule.layers.filter(layer => layer.users.length > 0).length;
  const totalResponderCount = new Set(
    schedule.layers.flatMap(layer => layer.users.map(member => member.userId))
  ).size;
  const restrictedLayerCount = schedule.layers.filter(layer => {
    const restrictions = layer.restrictions as {
      daysOfWeek?: number[];
      startHour?: number;
      endHour?: number;
    } | null;
    return Boolean(
      restrictions &&
      (restrictions.daysOfWeek?.length ||
        restrictions.startHour != null ||
        restrictions.endHour != null)
    );
  }).length;

  const timelineShifts = scheduleBlocks.map(block => ({
    id: block.id,
    start: block.start,
    end: block.end,
    layerName: block.layerName,
    layerId: block.layerId,
    userId: block.userId,
    userName: block.userName,
    userAvatar: block.userAvatar,
    userGender: block.userGender,
    source: block.source,
  }));
  const effectiveShifts = effectiveBlocks.map(block => ({
    id: block.id,
    start: block.start,
    end: block.end,
    layerName: block.layerName,
    layerId: block.layerId,
    userId: block.userId,
    userName: block.userName,
    userAvatar: block.userAvatar,
    userGender: block.userGender,
    source: block.source,
  }));
  const calendarShifts = scheduleBlocks.map(block => ({
    id: block.id,
    start: block.start.toISOString(),
    end: block.end.toISOString(),
    label: `${block.layerName}: ${block.userName}${block.source === 'override' ? ' (Override)' : ''}`,
    layerId: block.layerId,
    userId: block.userId,
    source: block.source,
    user: {
      name: block.userName,
      avatarUrl: block.userAvatar,
      gender: block.userGender,
    },
  }));

  const overrideListProps = {
    scheduleId: schedule.id,
    canDeleteOverride: capabilities.canDeleteOverride,
    deleteOverride,
    timeZone: schedule.timeZone,
  };

  const overview = (
    <>
      <ScheduleTimezoneNotice scheduleTimeZone={schedule.timeZone} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <CurrentCoverageDisplay
          currentCoverage={viewModel.currentCoverage}
          nextCoverageChange={viewModel.nextCoverageChange}
          scheduleTimeZone={schedule.timeZone}
          scheduleId={schedule.id}
          canCreateOverride={capabilities.canCreateOverride}
          coverageGap={viewModel.coverageGap}
          activeOverridesCount={activeOverrides.length}
          healthContent={
            <ScheduleHealthCheck
              layers={schedule.layers.map(layer => ({
                id: layer.id,
                name: layer.name,
                end: layer.end ? new Date(layer.end) : null,
                restrictions: layer.restrictions as {
                  daysOfWeek?: number[];
                  startHour?: number;
                  endHour?: number;
                } | null,
                users: layer.users.map(user => ({ userId: user.userId })),
              }))}
              shifts={effectiveBlocks.map(block => ({
                start: block.start.toISOString(),
                end: block.end.toISOString(),
              }))}
              timeZone={schedule.timeZone}
              rotationHref={`/schedules/${schedule.id}?tab=rotation`}
              overridesHref={`/schedules/${schedule.id}?tab=overrides`}
              activeOverrideCount={activeOverrides.length}
            />
          }
        />

        <ScheduleCoveragePreview
          effectiveShifts={effectiveBlocks.map(block => ({
            id: block.id,
            userId: block.userId,
            userName: block.userName,
            layerName: block.layerName,
            start: block.start,
            end: block.end,
            source: block.source,
            isAdditiveOverride: block.isAdditiveOverride,
          }))}
          timeZone={schedule.timeZone}
          viewerId={currentUser.id}
          viewerTimeZone={currentUser.timeZone || schedule.timeZone}
        />
      </div>

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="border-b bg-muted/20 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock3 className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Today&apos;s coverage</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Effective on-call and every active layer, shown separately in {schedule.timeZone}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <CoverageTimeline
            shifts={scheduleBlocks.map(block => ({
              id: block.id,
              userName: block.userName,
              userAvatar: block.userAvatar,
              userGender: block.userGender,
              layerName: block.layerName,
              start: block.start,
              end: block.end,
              source: block.source,
              isAdditiveOverride: block.isAdditiveOverride,
            }))}
            effectiveShifts={effectiveBlocks.map(block => ({
              id: block.id,
              userName: block.userName,
              userAvatar: block.userAvatar,
              userGender: block.userGender,
              layerName: block.layerName,
              start: block.start,
              end: block.end,
              source: block.source,
              isAdditiveOverride: block.isAdditiveOverride,
            }))}
            timeZone={schedule.timeZone}
          />
        </CardContent>
      </Card>

      <ScheduleCoverageExplorer
        timeline={
          <ScheduleTimeline
            shifts={timelineShifts}
            effectiveShifts={effectiveShifts}
            timeZone={schedule.timeZone}
          />
        }
        calendar={<ScheduleCalendar shifts={calendarShifts} timeZone={schedule.timeZone} />}
        scheduleId={schedule.id}
        scheduleName={schedule.name}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ScheduleLinkedPolicies linkedRules={linkedRules as any} scheduleId={schedule.id} />
        <ScheduleActivityFeed auditLogs={auditLogs} timeZone={schedule.timeZone} />
      </div>
    </>
  );

  const rotation = (
    <>
      <div className="flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers3 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Rotation layers</h2>
              <Badge variant="outline" size="xs">
                {schedule.layers.length} {schedule.layers.length === 1 ? 'layer' : 'layers'}
              </Badge>
              <Badge variant="secondary" size="xs">
                {totalResponderCount} {totalResponderCount === 1 ? 'responder' : 'responders'}
              </Badge>
              {restrictedLayerCount > 0 && (
                <Badge variant="secondary" size="xs">
                  {restrictedLayerCount} restricted
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Handoff sequence, timing rules, and layer precedence order.
            </p>
          </div>
        </div>
        {capabilities.canManageRotation && (
          <LayerCreateForm
            scheduleId={schedule.id}
            canManageSchedules={capabilities.canManageRotation}
            createLayer={createLayer}
            defaultStartDate={formatDateForInput(now, schedule.timeZone)}
            timeZone={schedule.timeZone}
            users={assignableUsers}
          />
        )}
      </div>

      {schedule.layers.length > 0 && configuredLayerCount < schedule.layers.length && (
        <Alert className="border-amber-500/25 bg-amber-500/[0.05]">
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="text-sm">
            {schedule.layers.length - configuredLayerCount} layer
            {schedule.layers.length - configuredLayerCount === 1 ? '' : 's'} need responders
          </AlertTitle>
          <AlertDescription className="text-xs">
            Assign team members to all rotation layers to ensure continuous on-call coverage.
          </AlertDescription>
        </Alert>
      )}

      {schedule.layers.length === 0 ? (
        <Card className="border-dashed p-10 text-center">
          <Layers3 className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 font-semibold">No rotation layers yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a rotation layer, then assign active responders.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {schedule.layers.map((layer, index) => (
            <LayerCard
              key={layer.id}
              layer={{
                id: layer.id,
                name: layer.name,
                start: new Date(layer.start),
                end: layer.end ? new Date(layer.end) : null,
                rotationLengthHours: layer.rotationLengthHours,
                shiftLengthHours: layer.shiftLengthHours,
                priority: layer.priority,
                restrictions: layer.restrictions as {
                  daysOfWeek?: number[];
                  startHour?: number;
                  endHour?: number;
                } | null,
                users: layer.users,
              }}
              scheduleId={schedule.id}
              timeZone={schedule.timeZone}
              users={assignableUsers}
              canManageSchedules={capabilities.canManageRotation}
              updateLayer={updateLayer}
              deleteLayer={deleteLayer}
              addLayerUser={addLayerUser}
              moveLayerUser={moveLayerUser}
              removeLayerUser={removeLayerUser}
              moveLayerPrecedence={moveLayerPrecedence}
              colorIndex={index}
              layerPosition={index}
              layerCount={schedule.layers.length}
            />
          ))}
        </div>
      )}
    </>
  );

  const overrides = (
    <>
      <div className="flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Coverage overrides</h2>
            <Badge variant="outline" size="xs">
              {activeOverrides.length} active
            </Badge>
            {upcomingOverrides.length > 0 && (
              <Badge variant="secondary" size="xs">
                {upcomingOverrides.length} upcoming
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Replace a responder or add temporary extra coverage without modifying rotation layers.
          </p>
        </div>
        <OverrideForm
          scheduleId={schedule.id}
          users={users}
          canCreateOverride={capabilities.canCreateOverride}
          createOverride={createOverride}
          scheduleTimeZone={schedule.timeZone}
        />
      </div>

      {!capabilities.canCreateOverride && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle className="text-sm">Read-only override access</AlertTitle>
          <AlertDescription className="text-xs">
            Assigned schedule members, owning team leads, and administrators can manage overrides.
          </AlertDescription>
        </Alert>
      )}

      {/* Active Overrides */}
      <section className="space-y-3" aria-labelledby="active-overrides-title">
        <div className="flex items-center gap-2">
          <h3 id="active-overrides-title" className="text-sm font-semibold">
            Active Overrides
          </h3>
          <Badge variant="success" size="xs">
            {activeOverrides.length}
          </Badge>
        </div>
        <OverrideList
          {...overrideListProps}
          overrides={activeOverrides}
          status="ACTIVE"
          emptyMessage="No overrides are active right now."
        />
      </section>

      {/* Upcoming Overrides */}
      {upcomingOverrides.length > 0 && (
        <section className="space-y-3" aria-labelledby="upcoming-overrides-title">
          <div className="flex items-center gap-2">
            <h3 id="upcoming-overrides-title" className="text-sm font-semibold">
              Upcoming Overrides
            </h3>
            <Badge variant="warning" size="xs">
              {upcomingOverrides.length}
            </Badge>
          </div>
          <OverrideList
            {...overrideListProps}
            overrides={upcomingOverrides}
            status="UPCOMING"
            emptyMessage="No upcoming overrides."
          />
        </section>
      )}

      {/* Override History */}
      <section className="space-y-3" aria-labelledby="override-history-title">
        <div className="flex items-center gap-2">
          <h3 id="override-history-title" className="text-sm font-semibold">
            Past Overrides
          </h3>
          <Badge variant="secondary" size="xs">
            {historyCount}
          </Badge>
        </div>
        <OverrideList
          {...overrideListProps}
          overrides={historyOverrides}
          status="COMPLETED"
          emptyMessage="No completed overrides."
        />
        {historyTotalPages > 1 && (
          <nav className="flex items-center justify-between" aria-label="Override history pages">
            <p className="text-xs text-muted-foreground">
              Page {historyPage} of {historyTotalPages}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" aria-disabled={historyPage === 1}>
                <Link
                  href={`/schedules/${schedule.id}?tab=overrides&history=${Math.max(1, historyPage - 1)}`}
                  tabIndex={historyPage === 1 ? -1 : undefined}
                >
                  Previous
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                aria-disabled={historyPage === historyTotalPages}
              >
                <Link
                  href={`/schedules/${schedule.id}?tab=overrides&history=${Math.min(historyTotalPages, historyPage + 1)}`}
                  tabIndex={historyPage === historyTotalPages ? -1 : undefined}
                >
                  Next
                </Link>
              </Button>
            </div>
          </nav>
        )}
      </section>
    </>
  );

  const settings = capabilities.canManageScheduleSettings ? (
    <ScheduleEditForm
      scheduleId={schedule.id}
      currentName={schedule.name}
      currentTimeZone={schedule.timeZone}
      updateSchedule={updateSchedule}
      canManageSchedules={capabilities.canManageScheduleSettings}
    />
  ) : (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>Schedule settings are read-only</AlertTitle>
      <AlertDescription>
        This schedule uses {schedule.timeZone}. Admins and responders can change schedule settings.
      </AlertDescription>
    </Alert>
  );

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-4">
        <Link
          href="/schedules"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Schedules</span>
          <span className="opacity-40">/</span>
          <span className="font-medium text-foreground">{schedule.name}</span>
        </Link>
        <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary to-primary/80 p-4 text-primary-foreground shadow-lg md:p-6">
          <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary-foreground/[0.08] blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
                <Calendar className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">
                  On-call schedule
                </p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-primary-foreground md:text-3xl">
                  {schedule.name}
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-primary-foreground/85">
                  {viewModel.summary}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-1.5 backdrop-blur-sm lg:min-w-[330px]">
              <div className="min-w-0 rounded-md px-3 py-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Responders
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
                  <Users className="h-3.5 w-3.5" /> {viewModel.participantCount}
                </p>
              </div>
              <div className="min-w-0 rounded-md border-x border-primary-foreground/20 px-3 py-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Layers
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
                  <Layers3 className="h-3.5 w-3.5" /> {viewModel.layerCount}
                </p>
              </div>
              <div className="min-w-0 rounded-md px-3 py-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Status
                </p>
                <p
                  className={`mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground ${
                    viewModel.coverageGap ? 'text-amber-100' : 'text-emerald-100'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {viewModel.coverageGap ? 'Gap' : 'Covered'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <ScheduleDetailTabs
        defaultTab={query?.tab}
        overview={overview}
        rotation={rotation}
        overrides={overrides}
        settings={settings}
      />
    </main>
  );
}
