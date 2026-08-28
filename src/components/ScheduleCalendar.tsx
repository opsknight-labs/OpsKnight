'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  formatDateTime,
  getDatePartsInTimeZone,
  startOfDayInTimeZone,
  startOfDayFromDateKey,
  startOfNextDayFromDateKey,
} from '@/lib/timezone';
import {
  groupCalendarShiftsForDay,
  type CalendarDayShift,
  type CalendarShiftIdentity,
} from '@/lib/schedules/calendar';
import UserAvatar from '@/components/UserAvatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { ChevronLeft, ChevronRight, Calendar, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type CalendarShift = CalendarShiftIdentity & {
  user?: {
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  };
};

type CalendarCell = {
  date: Date;
  inMonth: boolean;
  shifts: CalendarDayShift<CalendarShift>[];
};

type ScheduleCalendarProps = {
  shifts: CalendarShift[];
  timeZone: string;
};

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function subscribeToHydration() {
  return () => undefined;
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function getWeekdayIndex(dateKey: string, timeZone: string): number {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(startOfDayFromDateKey(dateKey, timeZone));
  const index = weekdayLabels.indexOf(day);
  return index === -1 ? 0 : index;
}

function getDayNumber(dateKey: string): number {
  const parts = dateKey.split('-');
  return Number(parts[2]);
}

function buildCalendar(baseDate: Date, shifts: CalendarShift[], timeZone: string) {
  const { year, month } = getDatePartsInTimeZone(baseDate, timeZone);
  const firstDayKey = `${year}-${String(month).padStart(2, '0')}-01`;
  const firstDayIndex = getWeekdayIndex(firstDayKey, timeZone);
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((firstDayIndex + totalDays) / 7) * 7;
  const firstCellKey = addDaysToDateKey(firstDayKey, -firstDayIndex);
  const cells: CalendarCell[] = [];

  for (let i = 0; i < totalCells; i++) {
    const dateKey = addDaysToDateKey(firstCellKey, i);
    const date = startOfDayFromDateKey(dateKey, timeZone);
    const dayEnd = startOfNextDayFromDateKey(dateKey, timeZone);
    const inMonth = dateKey.startsWith(`${year}-${String(month).padStart(2, '0')}-`);

    cells.push({
      date,
      inMonth,
      shifts: groupCalendarShiftsForDay(shifts, date, dayEnd),
    });
  }

  return cells;
}

function CalendarSkeleton() {
  return (
    <Card className="shadow-sm" aria-busy="true" aria-label="Loading on-call calendar">
      <CardHeader className="pb-3 border-b">
        <div className="h-6 w-44 rounded bg-muted animate-pulse" />
        <div className="h-4 w-72 max-w-full rounded bg-muted animate-pulse" />
      </CardHeader>
      <CardContent className="p-6 overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 min-w-[700px]">
          {Array.from({ length: 35 }, (_, index) => (
            <div key={index} className="min-h-24 rounded-lg border bg-muted/20 p-2">
              <div className="h-3 w-4 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScheduleCalendar({ shifts, timeZone }: ScheduleCalendarProps) {
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot
  );
  const [cursor, setCursor] = useState(() => new Date());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone,
      }).format(cursor),
    [cursor, timeZone]
  );

  const calendarCells = useMemo(
    () => buildCalendar(cursor, shifts, timeZone),
    [cursor, shifts, timeZone]
  );
  const todayKey = useMemo(() => formatDateKeyInTimeZone(new Date(), timeZone), [timeZone]);

  const toggleExpand = (dateKey: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const handlePrev = () => {
    setCursor(prev => {
      const { year, month } = getDatePartsInTimeZone(prev, timeZone);
      const previousMonthIndex = month - 2;
      const newYear = year + Math.floor(previousMonthIndex / 12);
      const newMonth = (((previousMonthIndex % 12) + 12) % 12) + 1;
      const monthKey = `${newYear}-${String(newMonth).padStart(2, '0')}-01`;
      return startOfDayFromDateKey(monthKey, timeZone);
    });
  };

  const handleNext = () => {
    setCursor(prev => {
      const { year, month } = getDatePartsInTimeZone(prev, timeZone);
      const nextMonthIndex = month;
      const newYear = year + Math.floor(nextMonthIndex / 12);
      const newMonth = (nextMonthIndex % 12) + 1;
      const monthKey = `${newYear}-${String(newMonth).padStart(2, '0')}-01`;
      return startOfDayFromDateKey(monthKey, timeZone);
    });
  };

  const handleToday = () => {
    setCursor(startOfDayInTimeZone(new Date(), timeZone));
  };

  if (!isHydrated) return <CalendarSkeleton />;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-xl font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              On-call Calendar
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              One entry per responder and layer each day. Overnight coverage is grouped into a
              single entry.
            </p>
          </div>
          <Badge variant="secondary" size="xs" className="gap-1.5 shrink-0">
            <Clock className="h-3 w-3" />
            {monthLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <div className="flex justify-end gap-2 mb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrev}
            className="h-8 px-3"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Prev
          </Button>
          <Button variant="outline" size="sm" onClick={handleToday} className="h-8 px-3">
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNext}
            className="h-8 px-3"
            aria-label="Next month"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="space-y-2 min-w-[700px]">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {weekdayLabels.map(day => (
                <div
                  key={day}
                  className="text-center text-sm font-semibold text-muted-foreground py-2"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map(cell => {
                const dateKey = formatDateKeyInTimeZone(cell.date, timeZone);
                const isToday = dateKey === todayKey;
                const isExpanded = expandedDates.has(dateKey);
                const preview = cell.shifts.slice(0, 2);
                const remaining = cell.shifts.length - preview.length;
                const showAll = isExpanded || cell.shifts.length <= 2;

                return (
                  <div
                    key={dateKey}
                    className={cn(
                      'min-h-24 p-2 rounded-lg border transition-all',
                      cell.inMonth
                        ? 'bg-card border-border hover:border-primary/30'
                        : 'bg-muted/30 border-transparent',
                      isToday && 'ring-2 ring-primary bg-primary/5'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          !cell.inMonth && 'text-muted-foreground',
                          isToday && 'text-primary font-bold'
                        )}
                      >
                        {getDayNumber(dateKey)}
                      </span>
                      {isToday && (
                        <div
                          className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
                          aria-label="Today"
                        />
                      )}
                    </div>

                    {cell.shifts.length > 0 && (
                      <div className="space-y-1.5">
                        {(showAll ? cell.shifts : preview).map(shift => {
                          const windows = shift.segments.map(segment => {
                            const startTime = formatDateTime(new Date(segment.start), timeZone, {
                              format: 'time',
                            });
                            const endTime = formatDateTime(new Date(segment.end), timeZone, {
                              format: 'time',
                            });
                            return `${startTime} - ${endTime}`;
                          });
                          const coverageLabel = windows.join(', ');

                          return (
                            <div
                              key={shift.groupKey}
                              className="group relative rounded-md bg-primary/10 border border-primary/20 p-1.5 text-xs hover:bg-primary/15 transition-colors cursor-default"
                              title={coverageLabel}
                              aria-label={`${shift.label}, ${coverageLabel}`}
                            >
                              {shift.user ? (
                                <div className="flex items-center gap-1.5">
                                  {shift.userId && (
                                    <UserAvatar
                                      userId={shift.userId}
                                      name={shift.user.name}
                                      avatarUrl={shift.user.avatarUrl}
                                      gender={shift.user.gender}
                                      size="xs"
                                      className="h-4 w-4 ring-1 ring-white/50"
                                    />
                                  )}
                                  <span className="font-medium text-foreground truncate flex-1 min-w-0">
                                    {shift.user.name}
                                  </span>
                                </div>
                              ) : (
                                <span className="font-medium text-foreground truncate block">
                                  {shift.label}
                                </span>
                              )}
                              {shift.segments.length > 1 ? (
                                <Badge
                                  variant="outline"
                                  size="xs"
                                  className="mt-1 h-4 border-primary/30"
                                >
                                  {shift.segments.length} windows
                                </Badge>
                              ) : shift.spansDayBoundary ? (
                                <Badge
                                  variant="outline"
                                  size="xs"
                                  className="mt-1 h-4 border-primary/30"
                                >
                                  overnight
                                </Badge>
                              ) : null}
                            </div>
                          );
                        })}

                        {remaining > 0 && !isExpanded && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={event => {
                              event.stopPropagation();
                              toggleExpand(dateKey);
                            }}
                            className="w-full h-6 text-xs font-medium text-primary hover:text-primary hover:bg-primary/10 gap-1"
                            aria-label={`Show ${remaining} more on-call entries for ${dateKey}`}
                          >
                            <ChevronDown className="h-3 w-3" />+{remaining} more
                          </Button>
                        )}
                        {isExpanded && cell.shifts.length > 2 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={event => {
                              event.stopPropagation();
                              toggleExpand(dateKey);
                            }}
                            className="w-full h-6 text-xs font-medium text-primary hover:text-primary hover:bg-primary/10 gap-1"
                            aria-label={`Show fewer on-call entries for ${dateKey}`}
                          >
                            <ChevronUp className="h-3 w-3" />
                            Show less
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
