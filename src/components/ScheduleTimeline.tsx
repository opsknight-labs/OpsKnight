'use client';

import { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { getDefaultAvatar } from '@/lib/avatar';
import { ChevronLeft, ChevronRight, Calendar, Clock, Users, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  formatDateTime,
  startOfDayFromDateKey,
} from '@/lib/timezone';

type TimelineShift = {
  id: string;
  userName: string;
  userAvatar?: string | null;
  userGender?: string | null;
  layerName: string;
  layerId?: string;
  userId?: string;
  start: Date;
  end: Date;
  source?: 'layer' | 'rotation' | 'override';
};

type ScheduleTimelineProps = {
  shifts: TimelineShift[];
  effectiveShifts: TimelineShift[];
  timeZone: string;
};

const LAYER_COLORS = [
  {
    bg: 'from-indigo-500 to-indigo-600',
    light: 'bg-indigo-500/10',
    text: 'text-indigo-700 dark:text-indigo-300',
    ring: 'ring-indigo-400',
  },
  {
    bg: 'from-emerald-500 to-emerald-600',
    light: 'bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-400',
  },
  {
    bg: 'from-amber-500 to-amber-600',
    light: 'bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
    ring: 'ring-amber-400',
  },
  {
    bg: 'from-rose-500 to-rose-600',
    light: 'bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
    ring: 'ring-rose-400',
  },
  {
    bg: 'from-sky-500 to-sky-600',
    light: 'bg-sky-500/10',
    text: 'text-sky-700 dark:text-sky-300',
    ring: 'ring-sky-400',
  },
  {
    bg: 'from-violet-500 to-violet-600',
    light: 'bg-violet-500/10',
    text: 'text-violet-700 dark:text-violet-300',
    ring: 'ring-violet-400',
  },
];

export default function ScheduleTimeline({
  shifts,
  effectiveShifts,
  timeZone,
}: ScheduleTimelineProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- intentional hydration safety
  }, []);

  const [daysToShow, setDaysToShow] = useState<7 | 14>(7);
  const todayKey = useMemo(() => formatDateKeyInTimeZone(new Date(), timeZone), [timeZone]);
  const [startDateKey, setStartDateKey] = useState<string>(todayKey);
  const [showFinalSchedule, setShowFinalSchedule] = useState(true);

  const startDate = useMemo(
    () => startOfDayFromDateKey(startDateKey, timeZone),
    [startDateKey, timeZone]
  );
  const endDate = useMemo(
    () => startOfDayFromDateKey(addDaysToDateKey(startDateKey, daysToShow), timeZone),
    [startDateKey, daysToShow, timeZone]
  );

  // Memoized date formatters to avoid creating new instances in render loops
  const dateFormatters = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }),
      dayNum: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone }),
      month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone }),
    }),
    [timeZone]
  );

  // Generate day columns
  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < daysToShow; i++) {
      result.push(startOfDayFromDateKey(addDaysToDateKey(startDateKey, i), timeZone));
    }
    return result;
  }, [startDateKey, daysToShow, timeZone]);

  // Get unique layer names for color assignment
  const layerColorMap = useMemo(() => {
    const uniqueLayers = [...new Set(shifts.map(s => s.layerName))];
    const map = new Map<string, (typeof LAYER_COLORS)[0]>();
    uniqueLayers.forEach((layer, index) => {
      map.set(layer, LAYER_COLORS[index % LAYER_COLORS.length]);
    });
    return map;
  }, [shifts]);

  // Filter shifts to the visible range
  const visibleShifts = useMemo(() => {
    return shifts.filter(shift => shift.start < endDate && shift.end > startDate);
  }, [shifts, startDate, endDate]);

  // Group shifts by layer for row rendering
  const shiftsByLayer = useMemo(() => {
    const groups = new Map<string, TimelineShift[]>();
    visibleShifts.forEach(shift => {
      const existing = groups.get(shift.layerName) || [];
      existing.push(shift);
      groups.set(shift.layerName, existing);
    });
    return [...groups.entries()];
  }, [visibleShifts]);

  // Effective coverage is calculated once by the canonical server-side engine.
  // This component only clips that presentation data to the selected window.
  const finalScheduleBlocks = useMemo(() => {
    return effectiveShifts.filter(shift => shift.start < endDate && shift.end > startDate);
  }, [effectiveShifts, endDate, startDate]);

  const handlePrevPeriod = () => {
    setStartDateKey(prev => addDaysToDateKey(prev, -daysToShow));
  };

  const handleNextPeriod = () => {
    setStartDateKey(prev => addDaysToDateKey(prev, daysToShow));
  };

  const handleToday = () => {
    setStartDateKey(todayKey);
  };

  const totalHours = daysToShow * 24;

  if (!isMounted) return null;

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="border-b bg-muted/25">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Schedule Timeline</CardTitle>
              <CardDescription className="text-xs">
                {formatDateTime(startDate, timeZone, { format: 'date', hour12: false })} -{' '}
                {formatDateTime(
                  startOfDayFromDateKey(addDaysToDateKey(startDateKey, daysToShow - 1), timeZone),
                  timeZone,
                  { format: 'date', hour12: false }
                )}
              </CardDescription>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="xs">
              {timeZone}
            </Badge>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              <Button
                onClick={() => setDaysToShow(7)}
                size="sm"
                variant={daysToShow === 7 ? 'secondary' : 'ghost'}
                className="h-7 px-3 text-xs"
              >
                7 Days
              </Button>
              <Button
                onClick={() => setDaysToShow(14)}
                size="sm"
                variant={daysToShow === 14 ? 'secondary' : 'ghost'}
                className="h-7 px-3 text-xs"
              >
                14 Days
              </Button>
            </div>

            {finalScheduleBlocks.length > 0 && (
              <Button
                onClick={() => setShowFinalSchedule(!showFinalSchedule)}
                size="sm"
                variant={showFinalSchedule ? 'secondary' : 'outline'}
                className={cn(
                  'h-7 px-3 text-xs gap-1.5',
                  showFinalSchedule && 'bg-foreground text-background hover:bg-foreground/90'
                )}
              >
                <Shield className="h-3 w-3" />
                Final
              </Button>
            )}

            <div className="flex items-center gap-1 rounded-lg border bg-background/70 p-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={handlePrevPeriod}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-xs font-medium rounded-md"
                onClick={handleToday}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={handleNextPeriod}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Timeline Grid */}
        <div className="overflow-x-auto">
          <div style={{ minWidth: daysToShow === 7 ? '700px' : '1000px' }}>
            {/* Day Headers */}
            <div className="sticky top-0 z-10 flex border-b bg-background">
              {days.map(day => {
                const dayKey = formatDateKeyInTimeZone(day, timeZone);
                const weekday = dateFormatters.weekday.format(day);
                const dayNum = dateFormatters.dayNum.format(day);
                const month = dateFormatters.month.format(day);
                const isCurrentDay = dayKey === todayKey;
                const isWeekend = weekday === 'Sat' || weekday === 'Sun';
                return (
                  <div
                    key={dayKey}
                    className={cn(
                      'flex-1 border-r px-2 py-3 text-center transition-colors last:border-r-0',
                      isCurrentDay && 'bg-primary/[0.08]',
                      isWeekend && !isCurrentDay && 'bg-muted/30'
                    )}
                  >
                    <div
                      className={cn(
                        'text-[10px] font-semibold uppercase tracking-wider mb-0.5',
                        isCurrentDay ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {weekday}
                    </div>
                    <div
                      className={cn(
                        'text-lg font-bold',
                        isCurrentDay ? 'text-primary' : 'text-foreground'
                      )}
                    >
                      {dayNum}
                    </div>
                    <div
                      className={cn(
                        'text-[10px] font-medium',
                        isCurrentDay ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {month}
                    </div>
                    {isCurrentDay && (
                      <div className="mt-1">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Layer Rows */}
            <div className="divide-y">
              {shiftsByLayer.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <div className="text-center">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No shifts scheduled</p>
                    <p className="text-xs mt-1">Shifts for this period will appear here</p>
                  </div>
                </div>
              ) : (
                shiftsByLayer.map(([layerName, layerShifts]) => {
                  const color = layerColorMap.get(layerName) || LAYER_COLORS[0];

                  // Sort shifts by start time and assign rows to handle overlaps
                  const sortedShifts = [...layerShifts].sort(
                    (a, b) => a.start.getTime() - b.start.getTime()
                  );
                  const rows: TimelineShift[][] = [];
                  const shiftRowMap = new Map<string, number>();

                  sortedShifts.forEach(shift => {
                    let rowIndex = 0;
                    while (true) {
                      const row = rows[rowIndex];
                      if (!row) {
                        rows[rowIndex] = [shift];
                        shiftRowMap.set(shift.id, rowIndex);
                        break;
                      }
                      const lastShift = row[row.length - 1];
                      // Check for temporal overlap
                      if (shift.start.getTime() >= lastShift.end.getTime()) {
                        row.push(shift);
                        shiftRowMap.set(shift.id, rowIndex);
                        break;
                      }
                      rowIndex++;
                    }
                  });

                  const rowHeight = 56; // 48px height + 8px gap
                  const containerHeight = Math.max(rows.length * rowHeight, 60);

                  return (
                    <div key={layerName} className="relative">
                      {/* Layer Label - position statically to avoid overlap */}
                      <div className="px-3 py-2 z-20 relative">
                        <div
                          className={cn(
                            'inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm',
                            color.light,
                            color.text
                          )}
                        >
                          {layerName}
                        </div>
                      </div>

                      {/* Grid Background */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {days.map(day => {
                          const dayKey = formatDateKeyInTimeZone(day, timeZone);
                          const dayWeekday = dateFormatters.weekday.format(day);
                          const isCurrentDay = dayKey === todayKey;
                          const isWeekend = dayWeekday === 'Sat' || dayWeekday === 'Sun';
                          return (
                            <div
                              key={dayKey}
                              className={cn(
                                'flex-1 border-r border-border/50 last:border-r-0',
                                isCurrentDay && 'bg-primary/[0.03]',
                                isWeekend && !isCurrentDay && 'bg-muted/20'
                              )}
                            />
                          );
                        })}
                      </div>

                      {/* Shift Blocks */}
                      <div
                        className="relative px-3 pb-4 transition-all duration-300"
                        style={{ height: `${containerHeight}px` }}
                      >
                        {sortedShifts.map(shift => {
                          const rowIndex = shiftRowMap.get(shift.id) || 0;

                          // Calculate position
                          const shiftStart = shift.start < startDate ? startDate : shift.start;
                          const shiftEnd = shift.end > endDate ? endDate : shift.end;

                          const startHours = (shiftStart.getTime() - startDate.getTime()) / 3600000;
                          const endHours = (shiftEnd.getTime() - startDate.getTime()) / 3600000;

                          const leftPercent = (startHours / totalHours) * 100;
                          const widthPercent = ((endHours - startHours) / totalHours) * 100;

                          const isOverride = shift.source === 'override';

                          return (
                            <TooltipProvider key={shift.id} delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={cn(
                                      'absolute h-12 rounded-xl flex items-center gap-2 px-3 cursor-pointer transition-all duration-200',
                                      'bg-gradient-to-r shadow-md hover:shadow-lg hover:scale-[1.02] hover:-translate-y-0.5',
                                      color.bg,
                                      isOverride && 'ring-2 ring-orange-400 ring-offset-2'
                                    )}
                                    style={{
                                      left: `${leftPercent}%`,
                                      width: `${Math.max(widthPercent, 1)}%`,
                                      top: `${rowIndex * rowHeight}px`,
                                    }}
                                  >
                                    <DirectUserAvatar
                                      avatarUrl={
                                        shift.userAvatar ||
                                        getDefaultAvatar(
                                          shift.userGender,
                                          shift.userId || shift.userName
                                        )
                                      }
                                      name={shift.userName}
                                      size="sm"
                                      className="ring-2 ring-white/40 shadow-sm"
                                      fallbackClassName="bg-white/30 text-white"
                                    />
                                    {widthPercent > 8 && (
                                      <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold text-white truncate">
                                          {shift.userName}
                                        </div>
                                        {widthPercent > 15 && (
                                          <div className="text-[10px] text-white/80 flex items-center gap-1 truncate">
                                            <Clock className="h-2.5 w-2.5" />
                                            {formatDateTime(shift.start, timeZone, {
                                              format: 'time',
                                              hour12: false,
                                            })}{' '}
                                            -{' '}
                                            {formatDateTime(shift.end, timeZone, {
                                              format: 'time',
                                              hour12: false,
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {isOverride && (
                                      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-orange-500 border-2 border-white flex items-center justify-center">
                                        <span className="text-[8px] font-bold text-white">!</span>
                                      </span>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="p-3 max-w-xs">
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                      <DirectUserAvatar
                                        avatarUrl={
                                          shift.userAvatar ||
                                          getDefaultAvatar(
                                            shift.userGender,
                                            shift.userId || shift.userName
                                          )
                                        }
                                        name={shift.userName}
                                        size="xs"
                                      />
                                      <span className="font-semibold text-foreground">
                                        {shift.userName}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {formatDateTime(shift.start, timeZone, {
                                        format: 'short',
                                        hour12: false,
                                      })}{' '}
                                      -{' '}
                                      {formatDateTime(shift.end, timeZone, {
                                        format: 'short',
                                        hour12: false,
                                      })}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={cn(
                                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                          color.light,
                                          color.text
                                        )}
                                      >
                                        {shift.layerName}
                                      </span>
                                      {isOverride && (
                                        <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-300">
                                          Override
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Final Schedule Row */}
            {showFinalSchedule && finalScheduleBlocks.length > 0 && (
              <div className="mt-2 border-t-2 border-border pt-2">
                <div className="relative">
                  {/* Final Schedule Label */}
                  <div className="px-3 py-2 z-20 relative">
                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-background shadow-sm">
                      <Shield className="h-3 w-3" />
                      Final Schedule
                    </div>
                  </div>

                  {/* Grid Background */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {days.map(day => {
                      const dayKey = formatDateKeyInTimeZone(day, timeZone);
                      const dayWeekday = dateFormatters.weekday.format(day);
                      const isCurrentDay = dayKey === todayKey;
                      const isWeekend = dayWeekday === 'Sat' || dayWeekday === 'Sun';
                      return (
                        <div
                          key={dayKey}
                          className={cn(
                            'flex-1 border-r border-border/50 last:border-r-0',
                            isCurrentDay && 'bg-primary/[0.03]',
                            isWeekend && !isCurrentDay && 'bg-muted/20'
                          )}
                        />
                      );
                    })}
                  </div>

                  {/* Final Schedule Blocks */}
                  <div className="relative px-3 pb-4" style={{ height: '70px' }}>
                    {finalScheduleBlocks.map(block => {
                      const blockStart = block.start < startDate ? startDate : block.start;
                      const blockEnd = block.end > endDate ? endDate : block.end;

                      const startHours = (blockStart.getTime() - startDate.getTime()) / 3600000;
                      const endHours = (blockEnd.getTime() - startDate.getTime()) / 3600000;

                      const leftPercent = (startHours / totalHours) * 100;
                      const widthPercent = ((endHours - startHours) / totalHours) * 100;

                      return (
                        <TooltipProvider
                          key={`final-${block.id}-${block.start.getTime()}`}
                          delayDuration={100}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  'absolute h-12 rounded-xl flex items-center gap-2 px-3 cursor-pointer transition-all duration-200',
                                  'bg-gradient-to-r from-foreground/85 to-foreground shadow-lg hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5',
                                  'ring-2 ring-foreground/25'
                                )}
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${Math.max(widthPercent, 1)}%`,
                                  top: '0px',
                                }}
                              >
                                <DirectUserAvatar
                                  avatarUrl={
                                    block.userAvatar ||
                                    getDefaultAvatar(
                                      block.userGender,
                                      block.userId || block.userName
                                    )
                                  }
                                  name={block.userName}
                                  size="sm"
                                  className="ring-2 ring-white/40 shadow-sm"
                                  fallbackClassName="bg-white/30 text-white"
                                />
                                {widthPercent > 8 && (
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold text-white truncate">
                                      {block.userName}
                                    </div>
                                    {widthPercent > 15 && (
                                      <div className="text-[10px] text-white/80 flex items-center gap-1 truncate">
                                        <Clock className="h-2.5 w-2.5" />
                                        {formatDateTime(block.start, timeZone, {
                                          format: 'time',
                                          hour12: false,
                                        })}{' '}
                                        -{' '}
                                        {formatDateTime(block.end, timeZone, {
                                          format: 'time',
                                          hour12: false,
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="p-3 max-w-xs">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <DirectUserAvatar
                                    avatarUrl={
                                      block.userAvatar ||
                                      getDefaultAvatar(
                                        block.userGender,
                                        block.userId || block.userName
                                      )
                                    }
                                    name={block.userName}
                                    size="xs"
                                  />
                                  <span className="font-semibold text-foreground">
                                    {block.userName}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {formatDateTime(block.start, timeZone, {
                                    format: 'short',
                                    hour12: false,
                                  })}{' '}
                                  -{' '}
                                  {formatDateTime(block.end, timeZone, {
                                    format: 'short',
                                    hour12: false,
                                  })}
                                </div>
                                <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                                  Effective On-Call
                                </span>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Legend */}
            {shiftsByLayer.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 border-t bg-muted/20 p-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Layers:
                </span>
                {[...layerColorMap.entries()].map(([layer, color]) => (
                  <div key={layer} className="flex items-center gap-2">
                    <div
                      className={cn('h-3 w-3 rounded-md bg-gradient-to-r shadow-sm', color.bg)}
                    />
                    <span className="text-xs font-medium text-muted-foreground">{layer}</span>
                  </div>
                ))}
                <div className="ml-4 flex items-center gap-2 border-l pl-4">
                  <div className="h-3 w-3 rounded-md bg-orange-500 ring-2 ring-orange-500/20" />
                  <span className="text-xs font-medium text-muted-foreground">Override</span>
                </div>
                {showFinalSchedule && finalScheduleBlocks.length > 0 && (
                  <div className="ml-4 flex items-center gap-2 border-l pl-4">
                    <div className="h-3 w-3 rounded-md bg-foreground ring-2 ring-foreground/20" />
                    <span className="text-xs font-medium text-muted-foreground">
                      Final Schedule
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
