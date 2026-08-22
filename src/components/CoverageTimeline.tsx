'use client';

import { useMemo, useState, useEffect } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { getDefaultAvatar } from '@/lib/avatar';
import { formatDateTime, startOfDayInTimeZone, startOfNextDayInTimeZone } from '@/lib/timezone';
import { Sun, Moon, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type CoverageBlock = {
  userId?: string;
  userName: string;
  userAvatar?: string | null;
  userGender?: string | null;
  layerName: string;
  start: Date;
  end: Date;
};

type CoverageTimelineProps = {
  shifts: CoverageBlock[];
  timeZone: string;
};

const LAYER_COLORS = [
  { bg: 'bg-indigo-500', light: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-amber-500', light: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-rose-500', light: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-sky-500', light: 'bg-sky-100', text: 'text-sky-700' },
];

export default function CoverageTimeline({ shifts, timeZone }: CoverageTimelineProps) {
  // Stable reference date for initial render (doesn't need to be precise for SSR)
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [isMounted, setIsMounted] = useState(false);

  // Mark as mounted and start update interval
  useEffect(() => {
    setIsMounted(true);
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
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

  // Filter shifts to today only
  const todayShifts = useMemo(() => {
    return shifts
      .filter(shift => {
        return shift.start.getTime() < todayEndTime && shift.end.getTime() > todayStartTime;
      })
      .map(shift => ({
        ...shift,
        // Clamp to today's bounds
        displayStart: new Date(Math.max(shift.start.getTime(), todayStartTime)),
        displayEnd: new Date(Math.min(shift.end.getTime(), todayEndTime)),
      }));
  }, [shifts, todayStartTime, todayEndTime]);

  // Get unique layer names for color assignment
  const layerColorMap = useMemo(() => {
    const uniqueLayers = [...new Set(todayShifts.map(s => s.layerName))];
    const map = new Map<string, (typeof LAYER_COLORS)[0]>();
    uniqueLayers.forEach((layer, index) => {
      map.set(layer, LAYER_COLORS[index % LAYER_COLORS.length]);
    });
    return map;
  }, [todayShifts]);

  // Current hour position - only calculate meaningful value on client
  const dayDurationMs = Math.max(todayEndTime - todayStartTime, 1);
  const currentHourPosition = isMounted
    ? Math.min(100, Math.max(0, ((currentTime.getTime() - todayStartTime) / dayDurationMs) * 100))
    : 50; // Default to middle during SSR to avoid hydration mismatch

  // Generate hour markers
  const hourMarkers = [0, 6, 12, 18];
  const formatHourLabel = (hour: number) =>
    formatDateTime(new Date(todayStart.getTime() + hour * 60 * 60 * 1000), timeZone, {
      format: 'time',
      hour12: true,
    })
      .replace(':00', '')
      .toLowerCase();

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" size="xs">
            Today
          </Badge>
          <span className="text-xs text-slate-500">
            {formatDateTime(currentTime, timeZone, { format: 'date' })}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <Clock className="h-3 w-3" />
          <span>{formatDateTime(currentTime, timeZone, { format: 'time', hour12: false })}</span>
          <Badge variant="outline" size="xs">
            {timeZone}
          </Badge>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative rounded-xl border border-slate-200/80 bg-white/90 overflow-hidden shadow-sm">
        {/* Hour Grid */}
        <div className="absolute inset-0 flex">
          {/* Night (0-6) */}
          <div className="w-1/4 bg-slate-50/70 border-r border-slate-100" />
          {/* Day (6-12) */}
          <div className="w-1/4 bg-amber-50/40 border-r border-slate-100" />
          {/* Day (12-18) */}
          <div className="w-1/4 bg-amber-50/40 border-r border-slate-100" />
          {/* Night (18-24) */}
          <div className="w-1/4 bg-slate-50/70" />
        </div>

        {/* Shift Blocks */}
        <div className="relative h-12">
          {todayShifts.map((shift, index) => {
            const startMinutes = Math.max(
              0,
              Math.round((shift.displayStart.getTime() - todayStart.getTime()) / 60000)
            );
            const endMinutes = Math.max(
              0,
              Math.round((shift.displayEnd.getTime() - todayStart.getTime()) / 60000)
            );
            const leftPercent = (startMinutes / (dayDurationMs / 60000)) * 100;
            const widthPercent = ((endMinutes - startMinutes) / (dayDurationMs / 60000)) * 100;
            const color = layerColorMap.get(shift.layerName) || LAYER_COLORS[0];
            const startLabel = formatDateTime(shift.displayStart, timeZone, {
              format: 'time',
              hour12: false,
            });
            const endLabel = formatDateTime(shift.displayEnd, timeZone, {
              format: 'time',
              hour12: false,
            });

            return (
              <TooltipProvider key={`${shift.layerName}-${index}`} delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'absolute top-2 h-8 rounded-lg flex items-center gap-1.5 px-1.5 cursor-pointer transition-all hover:ring-2 hover:ring-offset-1',
                        color.bg,
                        'hover:ring-slate-300'
                      )}
                      style={{
                        left: `${leftPercent}%`,
                        width: `${Math.max(widthPercent, 2)}%`,
                      }}
                    >
                      {widthPercent > 8 && (
                        <>
                          <Avatar className="h-5 w-5 ring-1 ring-white/30">
                            <AvatarImage
                              src={
                                shift.userAvatar ||
                                getDefaultAvatar(shift.userGender, shift.userId || shift.userName)
                              }
                            />
                            <AvatarFallback className="text-[8px] bg-white/20 text-white">
                              {shift.userName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          {widthPercent > 15 && (
                            <span className="text-[10px] font-medium text-white truncate">
                              {shift.userName.split(' ')[0]}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <div className="font-medium">{shift.userName}</div>
                    <div className="text-slate-400">
                      {startLabel} - {endLabel}
                    </div>
                    <div className="text-slate-500">{shift.layerName}</div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}

          {/* Current Time Indicator - only render on client */}
          {isMounted && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
              style={{ left: `${currentHourPosition}%` }}
            >
              <div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-red-500" />
            </div>
          )}
        </div>

        {/* Hour Labels */}
        <div className="relative h-5 border-t border-slate-100 flex text-[9px] text-slate-400">
          {hourMarkers.map(hour => (
            <div
              key={hour}
              className="absolute flex items-center gap-0.5"
              style={{ left: `${(hour / 24) * 100}%` }}
            >
              {hour === 6 && <Sun className="h-2.5 w-2.5 text-amber-400" />}
              {hour === 18 && <Moon className="h-2.5 w-2.5 text-slate-400" />}
              <span>{formatHourLabel(hour)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      {todayShifts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...layerColorMap.entries()].map(([layer, color]) => (
            <div key={layer} className="flex items-center gap-1.5">
              <div className={cn('h-2 w-2 rounded-sm', color.bg)} />
              <span className="text-[10px] text-slate-500">{layer}</span>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {todayShifts.length === 0 && (
        <div className="text-center py-3">
          <p className="text-xs text-slate-400">No shifts scheduled for today</p>
        </div>
      )}
    </div>
  );
}
