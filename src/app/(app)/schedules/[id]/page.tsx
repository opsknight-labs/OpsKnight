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
  try {
    ({ capabilities } = await assertCanViewSchedule(id));
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
  const [users, overridesInRange, currentAndFutureOverrides, historyCount, historyOverrides] =
    await Promise.all([
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
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <CurrentCoverageDisplay
          currentCoverage={viewModel.currentCoverage}
          nextCoverageChange={viewModel.nextCoverageChange}
          scheduleTimeZone={schedule.timeZone}
        />
        <Card className="overflow-hidden border-border/70 shadow-sm">
          <CardHeader className="border-b bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Schedule snapshot
                  </p>
                  <CardTitle className="mt-0.5 text-base">Operational status</CardTitle>
                </div>
              </div>
              <div
                className={`h-2.5 w-2.5 rounded-full ring-4 ${
                  viewModel.coverageGap
                    ? 'bg-amber-500 ring-amber-500/15'
                    : 'bg-emerald-500 ring-emerald-500/15'
                }`}
                aria-hidden="true"
              />
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Coverage
                </p>
                <Badge
                  variant={viewModel.coverageGap ? 'warning' : 'success'}
                  size="xs"
                  className="mt-1.5"
                >
                  {viewModel.coverageGap ? 'Gap detected' : 'Covered'}
                </Badge>
              </div>
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Overrides
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {activeOverrides.length}{' '}
                  <span className="font-normal text-muted-foreground">active</span>
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Globe2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{schedule.timeZone}</span>
              {upcomingOverrides.length > 0 && (
                <span className="shrink-0 font-medium text-foreground">
                  {upcomingOverrides.length} upcoming
                </span>
              )}
            </div>
          </CardContent>
        </Card>
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
      />
    </>
  );

  const rotation = (
    <>
      <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.08] via-card to-card p-5 shadow-sm md:p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
              <Layers3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Rotation configuration
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Rotation layers</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Build the handoff sequence, timing, and coverage rules that power this schedule.
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
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-primary/10 pt-4 sm:grid-cols-4">
          <div className="rounded-lg border border-blue-500/15 bg-blue-500/[0.06] px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Layers
            </p>
            <p className="mt-1 text-lg font-semibold">{schedule.layers.length}</p>
          </div>
          <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Responders
            </p>
            <p className="mt-1 text-lg font-semibold">{totalResponderCount}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Ready layers
            </p>
            <p className="mt-1 text-lg font-semibold">
              {configuredLayerCount}/{schedule.layers.length}
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Restricted
            </p>
            <p className="mt-1 text-lg font-semibold">{restrictedLayerCount}</p>
          </div>
        </div>
      </div>
      <Alert
        className={
          configuredLayerCount === schedule.layers.length && schedule.layers.length > 0
            ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
            : 'border-amber-500/25 bg-amber-500/[0.05]'
        }
      >
        {configuredLayerCount === schedule.layers.length && schedule.layers.length > 0 ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        )}
        <AlertTitle>
          {schedule.layers.length === 0
            ? 'Add a layer to start coverage'
            : configuredLayerCount === schedule.layers.length
              ? 'Rotation is ready for coverage'
              : `${schedule.layers.length - configuredLayerCount} layer${schedule.layers.length - configuredLayerCount === 1 ? '' : 's'} need responders`}
        </AlertTitle>
        <AlertDescription>
          Responder numbers show rotation order, not a live prediction. Effective on-call and the
          next real change are calculated from all layers, restrictions, priorities, and overrides
          in Overview.
        </AlertDescription>
      </Alert>
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
          <h2 className="text-lg font-semibold">Coverage overrides</h2>
          <p className="text-sm text-muted-foreground">
            Replace one responder or add extra coverage without changing the rotation.
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
          <AlertTitle>Read-only override access</AlertTitle>
          <AlertDescription>
            Assigned schedule members, owning team leads, and administrators can manage overrides.
          </AlertDescription>
        </Alert>
      )}

      <section
        className="space-y-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-4"
        aria-labelledby="active-overrides-title"
      >
        <div className="flex items-center gap-2">
          <h3 id="active-overrides-title" className="font-semibold">
            Active
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

      <section
        className="space-y-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-4"
        aria-labelledby="upcoming-overrides-title"
      >
        <div className="flex items-center gap-2">
          <h3 id="upcoming-overrides-title" className="font-semibold">
            Upcoming
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

      <section
        className="space-y-3 rounded-xl border bg-muted/[0.18] p-4"
        aria-labelledby="override-history-title"
      >
        <div className="flex items-center gap-2">
          <h3 id="override-history-title" className="font-semibold">
            History
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
