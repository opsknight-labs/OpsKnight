import prisma from '@/lib/prisma';
import { assertCanViewSchedule, getUserPermissions } from '@/lib/rbac';
import { buildScheduleBlocks, getFinalScheduleBlocks } from '@/lib/oncall';
import {
  formatDateForInput,
  formatDateTime,
  getTimeZoneLabel,
  formatDateKeyInTimeZone,
  addDaysToDateKey,
  startOfDayFromDateKey,
} from '@/lib/timezone';
import {
  addLayerUser,
  createLayer,
  createOverride,
  deleteLayer,
  deleteOverride,
  moveLayerUser,
  removeLayerUser,
  updateLayer,
  updateSchedule,
} from '../actions';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ScheduleCalendar from '@/components/ScheduleCalendar';
import LayerCard from '@/components/LayerCard';
import CurrentCoverageDisplay from '@/components/CurrentCoverageDisplay';
import CoverageTimeline from '@/components/CoverageTimeline';
import ScheduleEditForm from '@/components/ScheduleEditForm';
import ScheduleActionsPanel from '@/components/ScheduleActionsPanel';
import ScheduleTimeline from '@/components/ScheduleTimeline';
import ScheduleTimezoneNotice from '@/components/ScheduleTimezoneNotice';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Separator } from '@/components/ui/shadcn/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import {
  Calendar,
  Clock,
  Users,
  Layers,
  AlertTriangle,
  ArrowLeft,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { getDefaultAvatar } from '@/lib/avatar';

// Revalidate every 30 seconds to ensure current coverage is up-to-date
export const revalidate = 0;

export default async function ScheduleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ history?: string }>;
}) {
  const { id } = await params;
  const awaitedSearchParams = await searchParams;
  // Use current time - this will be recalculated on each page load/refresh
  const now = new Date();
  const calendarRangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const calendarRangeEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const historyPageSize = 8;
  const historyPage = Math.max(1, Number(awaitedSearchParams?.history ?? 1) || 1);

  const [schedule, users, overridesInRange, upcomingOverrides, historyCount, historyOverrides] =
    await Promise.all([
      prisma.onCallSchedule.findUnique({
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
                select: {
                  userId: true,
                  position: true,
                  user: {
                    select: { name: true, avatarUrl: true, gender: true },
                  },
                },
                orderBy: { position: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.user.findMany({
        select: { id: true, name: true, avatarUrl: true, gender: true },
        orderBy: { name: 'asc' },
      }),
      prisma.onCallOverride.findMany({
        where: {
          scheduleId: id,
          start: { lt: calendarRangeEnd },
          end: { gt: calendarRangeStart },
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
        where: { scheduleId: id, end: { gte: now } },
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
        take: 6,
      }),
      prisma.onCallOverride.count({
        where: { scheduleId: id, end: { lt: now } },
      }),
      prisma.onCallOverride.findMany({
        where: { scheduleId: id, end: { lt: now } },
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

  if (!schedule) notFound();

  try {
    await assertCanViewSchedule(schedule.id);
  } catch {
    notFound();
  }

  const permissions = await getUserPermissions();
  const canManageSchedules = permissions.isAdminOrResponder;

  // Timezone-aware coverage windows
  const todayKey = formatDateKeyInTimeZone(now, schedule.timeZone);
  const coverageRangeStart = startOfDayFromDateKey(
    addDaysToDateKey(todayKey, -1),
    schedule.timeZone
  );
  const coverageRangeEnd = startOfDayFromDateKey(addDaysToDateKey(todayKey, 90), schedule.timeZone);

  const layerPriorities = new Map(schedule.layers.map(l => [l.id, l.priority ?? 0]));

  // Cast layers with proper restrictions type
  const typedLayers = schedule.layers.map(layer => ({
    ...layer,
    restrictions: layer.restrictions as {
      daysOfWeek?: number[];
      startHour?: number;
      endHour?: number;
    } | null,
  }));

  const scheduleBlocks = buildScheduleBlocks(
    typedLayers,
    overridesInRange,
    calendarRangeStart,
    calendarRangeEnd,
    schedule.timeZone
  );
  const calendarShifts = scheduleBlocks.map(block => ({
    id: block.id,
    start: block.start.toISOString(),
    end: block.end.toISOString(),
    label: `${block.layerName}: ${block.userName}${block.source === 'override' ? ' (Override)' : ''}`,
    user: {
      name: block.userName,
      avatarUrl: block.userAvatar,
      gender: block.userGender,
    },
  }));

  const coverageBlocks = buildScheduleBlocks(
    typedLayers,
    overridesInRange,
    coverageRangeStart,
    coverageRangeEnd,
    schedule.timeZone
  );
  const finalCoverageBlocks = getFinalScheduleBlocks(coverageBlocks, layerPriorities);
  // Filter for blocks that are currently active (start <= now < end)
  const nowTime = now.getTime();
  const activeBlocks = finalCoverageBlocks.filter(block => {
    const blockStartTime = block.start.getTime();
    const blockEndTime = block.end.getTime();
    return blockStartTime <= nowTime && blockEndTime > nowTime;
  });
  const totalParticipants = schedule.layers.reduce((acc, layer) => acc + layer.users.length, 0);
  const historyTotalPages = Math.max(1, Math.ceil(historyCount / historyPageSize));

  const scheduleTimezoneLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone,
    timeZoneName: 'short',
  }).format(new Date());

  const formatShortTime = (date: Date) =>
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
      timeZone: schedule.timeZone,
    }).format(date);
  const scheduleNowLabel = formatShortTime(now);
  const scheduleTimezoneLongLabel = getTimeZoneLabel(schedule.timeZone);
  const formatOverrideRange = (start: Date, end: Date) =>
    `${formatDateTime(start, schedule.timeZone, { format: 'short', hour12: false })} - ${formatDateTime(end, schedule.timeZone, { format: 'short', hour12: false })}`;
  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  return (
    <div className="w-full px-4 py-6 space-y-6 [zoom:0.8]">
      {/* Header with Stats - Matching Teams/Users Pattern */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary via-primary/90 to-primary/75 text-primary-foreground shadow-lg">
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(255,255,255,0.25),transparent_55%)]" />
        <div className="relative p-5 md:p-7">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <Link
                href="/schedules"
                className="inline-flex items-center gap-1 text-xs opacity-80 hover:opacity-100 transition-opacity"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Schedules
              </Link>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <Calendar className="h-5 w-5" />
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
                  {schedule.name}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm text-white/80">
                <Badge variant="secondary" className="bg-white/15 text-white border-white/20">
                  {schedule.timeZone}
                </Badge>
                <Separator orientation="vertical" className="h-4 bg-white/30" />
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {scheduleNowLabel} ({scheduleTimezoneLabel})
                </span>
                <Separator orientation="vertical" className="h-4 bg-white/30" />
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {totalParticipants} participants
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 w-full lg:w-auto">
              <Card className="bg-white/10 border-white/20 backdrop-blur transition hover:bg-white/15">
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                      <Layers className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="text-xl md:text-2xl font-extrabold">
                        {schedule.layers.length}
                      </div>
                      <div className="text-[10px] md:text-xs opacity-80">Layers</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-white/20 backdrop-blur transition hover:bg-white/15">
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                      <Users className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="text-xl md:text-2xl font-extrabold">{totalParticipants}</div>
                      <div className="text-[10px] md:text-xs opacity-80">Participants</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-white/20 backdrop-blur transition hover:bg-white/15">
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                      <ShieldCheck className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div
                        className={`text-xl md:text-2xl font-extrabold ${activeBlocks.length > 0 ? 'text-emerald-200' : 'text-red-200'}`}
                      >
                        {activeBlocks.length}
                      </div>
                      <div className="text-[10px] md:text-xs opacity-80">On-Call Now</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-white/20 backdrop-blur transition hover:bg-white/15">
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                      <AlertTriangle className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="text-xl md:text-2xl font-extrabold text-amber-200">
                        {upcomingOverrides.length}
                      </div>
                      <div className="text-[10px] md:text-xs opacity-80">Upcoming Overrides</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <ScheduleTimezoneNotice scheduleTimeZone={schedule.timeZone} />

      {/* Main Grid - 4 columns like teams page */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Main Content - 3 columns */}
        <div className="xl:col-span-3 space-y-4 md:space-y-6">
          {/* Today's Coverage */}
          <Card className="overflow-hidden border-slate-200/80">
            <CardHeader className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50/70 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-primary" />
                  Today&apos;s Coverage
                </CardTitle>
                <CardDescription>24-hour view in the schedule timezone</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={activeBlocks.length > 0 ? 'success' : 'warning'} size="xs">
                  {activeBlocks.length > 0 ? 'Active coverage' : 'No coverage'}
                </Badge>
                <Badge variant="outline" size="xs">
                  {schedule.timeZone}
                </Badge>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {scheduleNowLabel}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <CoverageTimeline
                shifts={scheduleBlocks.map(block => ({
                  userName: block.userName,
                  userAvatar: block.userAvatar,
                  userGender: block.userGender,
                  layerName: block.layerName,
                  start: block.start,
                  end: block.end,
                }))}
                timeZone={schedule.timeZone}
              />
            </CardContent>
          </Card>

          {/* Schedule Timeline - 7/14 Days (has built-in header) */}
          <ScheduleTimeline
            shifts={scheduleBlocks.map(block => ({
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
            }))}
            timeZone={schedule.timeZone}
            layerPriorities={layerPriorities}
          />

          {/* Monthly Calendar (has built-in header) */}
          <ScheduleCalendar shifts={calendarShifts} timeZone={schedule.timeZone} />
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-4 md:space-y-6">
          {/* Current On-Call - has its own Card with gradient styling */}
          <CurrentCoverageDisplay
            key={`coverage-${schedule.id}-${schedule.layers.map(l => `${l.id}-${l.start.getTime()}-${l.end?.getTime() || 'null'}`).join('-')}`}
            initialBlocks={activeBlocks.map(block => ({
              id: block.id,
              userName: block.userName,
              userAvatar: block.userAvatar,
              userGender: block.userGender,
              layerName: block.layerName,
              start: block.start.toISOString(),
              end: block.end.toISOString(),
            }))}
            scheduleTimeZone={schedule.timeZone}
          />

          {/* What are Layers - Info Card */}
          <Alert className="border-blue-200/80 bg-blue-50/70">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-sm text-blue-900">Layering basics</AlertTitle>
            <AlertDescription className="text-xs text-blue-700">
              Layers define on-call rotations. Higher layers override lower ones. Use a primary
              layer for baseline coverage and add secondary layers for backup.
            </AlertDescription>
          </Alert>

          {/* Rotation Layers */}
          <Card className="overflow-hidden border-slate-200/80">
            <CardHeader className="p-4 pb-2 border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4 text-indigo-600" />
                    Rotation Layers
                  </CardTitle>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-slate-500 hover:text-slate-700"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Layers are evaluated from top to bottom. Higher layers override lower ones
                        during overlaps.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Badge variant="secondary">{schedule.layers.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-3 space-y-2">
              {schedule.layers.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-medium">No layers defined</p>
                </div>
              ) : (
                schedule.layers.map((layer, index) => (
                  <LayerCard
                    key={layer.id}
                    layer={{
                      id: layer.id,
                      name: layer.name,
                      start: new Date(layer.start),
                      end: layer.end ? new Date(layer.end) : null,
                      rotationLengthHours: layer.rotationLengthHours,
                      shiftLengthHours: layer.shiftLengthHours,
                      restrictions: layer.restrictions as {
                        daysOfWeek?: number[];
                        startHour?: number;
                        endHour?: number;
                      } | null,
                      users: layer.users,
                    }}
                    scheduleId={schedule.id}
                    timeZone={schedule.timeZone}
                    users={users}
                    canManageSchedules={canManageSchedules}
                    updateLayer={updateLayer}
                    deleteLayer={deleteLayer}
                    addLayerUser={addLayerUser}
                    moveLayerUser={moveLayerUser}
                    removeLayerUser={removeLayerUser}
                    colorIndex={index}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {/* Quick Actions - has its own Card */}
          <ScheduleActionsPanel
            scheduleId={schedule.id}
            users={users}
            canManageSchedules={canManageSchedules}
            createLayer={createLayer}
            createOverride={createOverride}
            defaultStartDate={formatDateForInput(now, schedule.timeZone)}
            scheduleTimeZone={schedule.timeZone}
          />

          {/* Schedule Settings */}
          {canManageSchedules && (
            <Card className="overflow-hidden border-slate-200/80">
              <CardHeader className="p-4 pb-2 border-b border-slate-100 bg-slate-50/70">
                <CardTitle className="text-sm">Schedule Settings</CardTitle>
                <CardDescription className="text-xs">
                  Rename the schedule or change its timezone
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-3">
                <ScheduleEditForm
                  scheduleId={schedule.id}
                  currentName={schedule.name}
                  currentTimeZone={schedule.timeZone}
                  updateSchedule={updateSchedule}
                  canManageSchedules={canManageSchedules}
                />
              </CardContent>
            </Card>
          )}

          {/* Overrides Section */}
          <Card className="overflow-hidden border-slate-200/80">
            <CardHeader className="p-4 pb-2 border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Overrides
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Temporary swaps and coverage changes
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="warning" size="xs">
                    {upcomingOverrides.length} upcoming
                  </Badge>
                  <Badge variant="secondary" size="xs">
                    {historyCount} past
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-3 space-y-4">
              {/* Upcoming */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Upcoming</p>
                {upcomingOverrides.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No upcoming overrides</p>
                ) : (
                  <div className="space-y-2">
                    {upcomingOverrides.map(o => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-7 w-7">
                            <AvatarImage
                              src={
                                o.user.avatarUrl ||
                                getDefaultAvatar(o.user.gender, o.userId || o.user.name)
                              }
                            />
                            <AvatarFallback className="text-[10px] font-semibold">
                              {getInitials(o.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 truncate">
                              {o.user.name}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {formatOverrideRange(new Date(o.start), new Date(o.end))}
                            </p>
                            {o.replacesUser?.name && (
                              <p className="text-[10px] text-slate-400 truncate">
                                Replaces {o.replacesUser.name}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant="warning" size="xs">
                          Upcoming
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* History */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  History ({historyCount})
                </p>
                {historyOverrides.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No past overrides</p>
                ) : (
                  <div className="space-y-2">
                    {historyOverrides.slice(0, 3).map(o => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-7 w-7">
                            <AvatarImage
                              src={
                                o.user.avatarUrl ||
                                getDefaultAvatar(o.user.gender, o.userId || o.user.name)
                              }
                            />
                            <AvatarFallback className="text-[10px] font-semibold">
                              {getInitials(o.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">
                              {o.user.name}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {formatOverrideRange(new Date(o.start), new Date(o.end))}
                            </p>
                            {o.replacesUser?.name && (
                              <p className="text-[10px] text-slate-400 truncate">
                                Replaced {o.replacesUser.name}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant="secondary" size="xs">
                          Completed
                        </Badge>
                      </div>
                    ))}
                    {historyCount > 3 && (
                      <p className="text-[10px] text-muted-foreground text-center">
                        +{historyCount - 3} more
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Pagination for history */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="text-[10px] text-muted-foreground">
                    Page {historyPage}/{historyTotalPages}
                  </div>
                  <div className="flex gap-1">
                    <Link
                      href={`/schedules/${schedule.id}?history=${Math.max(1, historyPage - 1)}`}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        disabled={historyPage === 1}
                      >
                        Prev
                      </Button>
                    </Link>
                    <Link
                      href={`/schedules/${schedule.id}?history=${Math.min(historyTotalPages, historyPage + 1)}`}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
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
