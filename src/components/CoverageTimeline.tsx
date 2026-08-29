'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { getDefaultAvatar } from '@/lib/avatar';
import { formatDateTime, startOfDayInTimeZone, startOfNextDayInTimeZone } from '@/lib/timezone';
import { Clock, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

type CoverageBlock = {
  id: string;
  userId?: string;
  userName: string;
  userAvatar?: string | null;
  userGender?: string | null;
  layerName: string;
  start: Date;
  end: Date;
  source?: 'rotation' | 'override';
  isAdditiveOverride?: boolean;
};

type DisplayBlock = CoverageBlock & { displayStart: Date; displayEnd: Date };

type CoverageTimelineProps = {
  shifts: CoverageBlock[];
  effectiveShifts: CoverageBlock[];
  timeZone: string;
};

const LAYER_COLORS = [
  { bg: 'bg-indigo-500' },
  { bg: 'bg-emerald-500' },
  { bg: 'bg-amber-500' },
  { bg: 'bg-rose-500' },
  { bg: 'bg-sky-500' },
];

type TimelineRow = {
  id: string;
  label: string;
  description: string;
  shifts: DisplayBlock[];
  color: (typeof LAYER_COLORS)[0];
  effective?: boolean;
};

function subscribeToMount() {
  return () => {};
}

function clampToToday(blocks: CoverageBlock[], start: number, end: number): DisplayBlock[] {
  return blocks
    .filter(block => block.start.getTime() < end && block.end.getTime() > start)
    .map(block => ({
      ...block,
      displayStart: new Date(Math.max(block.start.getTime(), start)),
      displayEnd: new Date(Math.min(block.end.getTime(), end)),
    }));
}

function splitOverlappingShifts(shifts: DisplayBlock[]): DisplayBlock[][] {
  const lanes: DisplayBlock[][] = [];
  const sorted = [...shifts].sort((a, b) => a.displayStart.getTime() - b.displayStart.getTime());

  for (const shift of sorted) {
    const lane = lanes.find(candidate => {
      const previous = candidate[candidate.length - 1];
      return previous.displayEnd.getTime() <= shift.displayStart.getTime();
    });
    if (lane) {
      lane.push(shift);
    } else {
      lanes.push([shift]);
    }
  }

  return lanes;
}

export default function CoverageTimeline({
  shifts,
  effectiveShifts,
  timeZone,
}: CoverageTimelineProps) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const isMounted = useSyncExternalStore(
    subscribeToMount,
    () => true,
    () => false
  );

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const todayStart = useMemo(
    () => startOfDayInTimeZone(currentTime, timeZone),
    [currentTime, timeZone]
  );
  const todayEnd = useMemo(
    () => startOfNextDayInTimeZone(currentTime, timeZone),
    [currentTime, timeZone]
  );
  const todayStartTime = todayStart.getTime();
  const todayEndTime = todayEnd.getTime();
  const todayShifts = useMemo(
    () => clampToToday(shifts, todayStartTime, todayEndTime),
    [shifts, todayStartTime, todayEndTime]
  );
  const todayEffectiveShifts = useMemo(
    () => clampToToday(effectiveShifts, todayStartTime, todayEndTime),
    [effectiveShifts, todayStartTime, todayEndTime]
  );

  const layerColorMap = useMemo(() => {
    const names = [...new Set(todayShifts.map(shift => shift.layerName))];
    return new Map(names.map((name, index) => [name, LAYER_COLORS[index % LAYER_COLORS.length]]));
  }, [todayShifts]);

  const rows = useMemo<TimelineRow[]>(() => {
    const nextRows: TimelineRow[] = [];
    const baseEffectiveShifts = todayEffectiveShifts.filter(shift => !shift.isAdditiveOverride);
    const additiveEffectiveShifts = todayEffectiveShifts.filter(shift => shift.isAdditiveOverride);

    splitOverlappingShifts(baseEffectiveShifts).forEach((lane, index) => {
      nextRows.push({
        id: `effective-on-call-${index}`,
        label: index === 0 ? 'Effective on-call' : 'Additional effective coverage',
        description:
          index === 0 ? 'Priority and overrides applied' : 'Concurrent effective coverage',
        shifts: lane,
        color: { bg: 'bg-primary' },
        effective: true,
      });
    });
    splitOverlappingShifts(additiveEffectiveShifts).forEach((lane, index) => {
      nextRows.push({
        id: `additive-on-call-${index}`,
        label: index === 0 ? 'Also on call' : 'Additional on-call',
        description: 'Additive override coverage',
        shifts: lane,
        color: { bg: 'bg-emerald-500' },
        effective: true,
      });
    });
    if (todayEffectiveShifts.length === 0 && todayShifts.length > 0) {
      nextRows.push({
        id: 'effective-gap',
        label: 'Effective on-call',
        description: 'No effective coverage',
        shifts: [],
        color: { bg: 'bg-amber-500' },
        effective: true,
      });
    }
    for (const [name, color] of layerColorMap.entries()) {
      nextRows.push({
        id: `layer-${name}`,
        label: name,
        description: 'Layer coverage',
        shifts: todayShifts.filter(shift => shift.layerName === name),
        color,
      });
    }
    return nextRows;
  }, [layerColorMap, todayEffectiveShifts, todayShifts]);

  const dayDurationMs = Math.max(todayEndTime - todayStartTime, 1);
  const currentHourPosition = isMounted
    ? Math.min(100, Math.max(0, ((currentTime.getTime() - todayStartTime) / dayDurationMs) * 100))
    : 50;
  const hourMarkers = [0, 6, 12, 18];
  const formatHourLabel = (hour: number) =>
    formatDateTime(new Date(todayStartTime + hour * 60 * 60 * 1000), timeZone, {
      format: 'time',
      hour12: true,
    })
      .replace(':00', '')
      .toLowerCase();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" size="xs">
            Today
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(currentTime, timeZone, { format: 'date' })}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{formatDateTime(currentTime, timeZone, { format: 'time', hour12: false })}</span>
          <Badge variant="outline" size="xs">
            {timeZone}
          </Badge>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No coverage is scheduled for today.
          </div>
        ) : (
          <div className="divide-y">
            {rows.map(row => (
              <div
                key={row.id}
                className="grid grid-cols-[108px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]"
              >
                <div
                  className={cn(
                    'flex flex-col justify-center border-r px-2 py-2 sm:px-3',
                    row.effective && 'bg-primary/[0.035]'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', row.color.bg)} />
                    <span className="truncate text-[11px] font-semibold text-foreground">
                      {row.label}
                    </span>
                  </div>
                  <span className="mt-0.5 truncate pl-3.5 text-[10px] text-muted-foreground">
                    {row.description}
                  </span>
                </div>
                <div className="relative h-12 overflow-hidden">
                  <div className="absolute inset-0 flex" aria-hidden="true">
                    <div className="w-1/4 border-r bg-muted/30" />
                    <div className="w-1/4 border-r bg-amber-500/[0.04]" />
                    <div className="w-1/4 border-r bg-amber-500/[0.04]" />
                    <div className="w-1/4 bg-muted/30" />
                  </div>
                  {row.shifts.map(shift => {
                    const startMinutes = Math.max(
                      0,
                      (shift.displayStart.getTime() - todayStartTime) / 60000
                    );
                    const endMinutes = Math.max(
                      0,
                      (shift.displayEnd.getTime() - todayStartTime) / 60000
                    );
                    const leftPercent = (startMinutes / (dayDurationMs / 60000)) * 100;
                    const widthPercent =
                      ((endMinutes - startMinutes) / (dayDurationMs / 60000)) * 100;
                    const blockColor = row.effective
                      ? 'bg-primary'
                      : shift.source === 'override'
                        ? 'bg-amber-500'
                        : row.color.bg;
                    return (
                      <TooltipProvider key={`${row.id}-${shift.id}`} delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'absolute top-2 flex h-8 items-center gap-1.5 rounded-lg px-1.5 shadow-sm transition-shadow hover:ring-2 hover:ring-border hover:ring-offset-1',
                                blockColor
                              )}
                              style={{
                                left: `${leftPercent}%`,
                                width: `${Math.max(widthPercent, 2)}%`,
                              }}
                            >
                              {widthPercent > 8 && (
                                <Avatar className="h-5 w-5 shrink-0 ring-1 ring-white/30">
                                  <AvatarImage
                                    src={
                                      shift.userAvatar ||
                                      getDefaultAvatar(
                                        shift.userGender,
                                        shift.userId || shift.userName
                                      )
                                    }
                                  />
                                  <AvatarFallback className="bg-white/20 text-[8px] text-white">
                                    {shift.userName.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                              {widthPercent > 15 && (
                                <span className="truncate text-[10px] font-medium text-white">
                                  {shift.userName.split(' ')[0]}
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <div className="font-medium">{shift.userName}</div>
                            <div className="text-muted-foreground">
                              {formatDateTime(shift.displayStart, timeZone, {
                                format: 'time',
                                hour12: false,
                              })}{' '}
                              –{' '}
                              {formatDateTime(shift.displayEnd, timeZone, {
                                format: 'time',
                                hour12: false,
                              })}
                            </div>
                            <div className="text-muted-foreground">
                              {row.effective ? 'Effective on-call' : `${row.label} layer`}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                  {isMounted && (
                    <div
                      className="absolute bottom-0 top-0 z-10 w-0.5 bg-red-500"
                      style={{ left: `${currentHourPosition}%` }}
                    >
                      <div className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[108px_minmax(0,1fr)] border-t bg-muted/20 text-[9px] text-muted-foreground sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="border-r" />
              <div className="relative flex h-5">
                {hourMarkers.map(hour => (
                  <div
                    key={hour}
                    className="absolute flex items-center gap-0.5"
                    style={{ left: `${(hour / 24) * 100}%` }}
                  >
                    {hour === 6 && <Sun className="h-2.5 w-2.5 text-amber-400" />}
                    {hour === 18 && <Moon className="h-2.5 w-2.5" />}
                    <span>{formatHourLabel(hour)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Effective rows show who owns the escalation; layer rows show the underlying coverage.
        </p>
      )}
    </div>
  );
}
