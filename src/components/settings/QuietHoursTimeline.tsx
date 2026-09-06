'use client';

import { useMemo, useState, useEffect } from 'react';
import { Moon, Sun, ShieldAlert, Clock, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

type Props = {
  startMinutes: number;
  endMinutes: number;
  enabled: boolean;
  weekendAllDay: boolean;
  timeZone?: string;
};

function formatMinutesToLabel(minutes: number): string {
  const safe = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function QuietHoursTimeline({
  startMinutes,
  endMinutes,
  enabled,
  weekendAllDay,
  timeZone,
}: Props) {
  // Live current time in target timezone
  const [currentMinuteOfDay, setCurrentMinuteOfDay] = useState<number | null>(null);

  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timeZone || 'UTC',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        });
        const parts = formatter.formatToParts(now);
        const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
        setCurrentMinuteOfDay((hour % 24) * 60 + minute);
      } catch {
        const now = new Date();
        setCurrentMinuteOfDay(now.getUTCHours() * 60 + now.getUTCMinutes());
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 30_000);
    return () => clearInterval(interval);
  }, [timeZone]);

  // Calculate quiet duration in hours
  const quietDurationHours = useMemo(() => {
    let diff = endMinutes - startMinutes;
    if (diff <= 0) diff += 1440;
    return (diff / 60).toFixed(1);
  }, [startMinutes, endMinutes]);

  const activeDurationHours = useMemo(() => {
    return (24 - parseFloat(quietDurationHours)).toFixed(1);
  }, [quietDurationHours]);

  // Generate timeline segments
  const isOvernight = startMinutes > endMinutes;

  // Segment widths in percentage
  const segments = useMemo(() => {
    if (!enabled) {
      return [{ type: 'active', start: 0, width: 100, label: 'All Day Active Paging' }];
    }

    if (isOvernight) {
      // 00:00 -> endMinutes (Quiet)
      // endMinutes -> startMinutes (Active)
      // startMinutes -> 24:00 (Quiet)
      const p1 = (endMinutes / 1440) * 100;
      const p2 = ((startMinutes - endMinutes) / 1440) * 100;
      const p3 = ((1440 - startMinutes) / 1440) * 100;
      return [
        { type: 'quiet', start: 0, width: p1, label: 'Quiet' },
        { type: 'active', start: p1, width: p2, label: 'Active Paging' },
        { type: 'quiet', start: p1 + p2, width: p3, label: 'Quiet' },
      ];
    } else {
      // 00:00 -> startMinutes (Active)
      // startMinutes -> endMinutes (Quiet)
      // endMinutes -> 24:00 (Active)
      const p1 = (startMinutes / 1440) * 100;
      const p2 = ((endMinutes - startMinutes) / 1440) * 100;
      const p3 = ((1440 - endMinutes) / 1440) * 100;
      return [
        { type: 'active', start: 0, width: p1, label: 'Active' },
        { type: 'quiet', start: p1, width: p2, label: 'Quiet' },
        { type: 'active', start: p1 + p2, width: p3, label: 'Active' },
      ];
    }
  }, [enabled, isOvernight, startMinutes, endMinutes]);

  const currentPercent =
    currentMinuteOfDay !== null
      ? Math.min(100, Math.max(0, (currentMinuteOfDay / 1440) * 100))
      : null;

  return (
    <div className="mt-4 rounded-xl border border-border/80 bg-card/60 p-4 sm:p-5 space-y-4 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">24-Hour Schedule Timeline</h4>
          {enabled && (
            <Badge
              variant="outline"
              size="xs"
              className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 text-[10px] gap-1"
            >
              <Moon className="h-2.5 w-2.5" /> {quietDurationHours}h Quiet / Day
            </Badge>
          )}
        </div>
        {weekendAllDay && enabled && (
          <Badge
            variant="outline"
            size="xs"
            className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] gap-1 self-start sm:self-auto"
          >
            <Sparkles className="h-2.5 w-2.5" /> 24h Weekends Silenced
          </Badge>
        )}
      </div>

      {/* Visual Bar */}
      <div className="relative pt-2 pb-5">
        {/* The Track */}
        <div className="relative h-6 w-full rounded-lg overflow-hidden flex bg-muted/40 border border-border">
          {segments.map((seg, idx) => (
            <div
              key={idx}
              style={{ width: `${seg.width}%` }}
              className={`h-full transition-all duration-300 flex items-center justify-center text-[10px] font-medium select-none ${
                seg.type === 'quiet'
                  ? 'bg-gradient-to-r from-indigo-500/25 to-purple-500/25 border-x border-indigo-500/30 text-indigo-700 dark:text-indigo-300'
                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {seg.width > 12 && (
                <span className="flex items-center gap-1 opacity-90 truncate px-1">
                  {seg.type === 'quiet' ? (
                    <>
                      <Moon className="h-2.5 w-2.5 shrink-0" />
                      <span className="hidden sm:inline">Quiet</span>
                    </>
                  ) : (
                    <>
                      <Sun className="h-2.5 w-2.5 shrink-0" />
                      <span className="hidden sm:inline">Active</span>
                    </>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Current Time Needle */}
        {currentPercent !== null && (
          <div
            style={{ left: `${currentPercent}%` }}
            className="absolute top-0 bottom-4 w-0.5 bg-primary shadow-sm z-10 pointer-events-none transition-all duration-500"
          >
            <div className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background animate-pulse" />
            <span className="absolute -bottom-4 -left-3 text-[9px] font-mono font-bold text-primary whitespace-nowrap bg-card/90 px-1 rounded shadow-2xs">
              Now
            </span>
          </div>
        )}

        {/* Hour Ticks */}
        <div className="relative mt-1.5 flex justify-between text-[10px] font-mono text-muted-foreground select-none px-0.5">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>

      {/* Details & Legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-border/60 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-2.5 w-2.5 rounded-sm bg-gradient-to-r from-indigo-500/40 to-purple-500/40 border border-indigo-500/50" />
          <span>
            <strong>Quiet:</strong> {formatMinutesToLabel(startMinutes)} –{' '}
            {formatMinutesToLabel(endMinutes)} ({quietDurationHours}h)
          </span>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/50" />
          <span>
            <strong>Active Paging:</strong> {activeDurationHours}h / day
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground sm:justify-end">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-[11px]">
            High & Medium (P1/P2) alerts always bypass quiet hours
          </span>
        </div>
      </div>
    </div>
  );
}
