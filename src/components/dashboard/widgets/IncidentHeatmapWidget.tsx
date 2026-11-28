'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';
import { useTimezone } from '@/contexts/TimezoneContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';

/**
 * Incident volume is not a status, so the ramp is the theme-aware neutral ink scale (darker =
 * more in light, brighter = more in dark) rather than a status hue.
 */
const HEAT_LEVELS = ['bg-muted', 'bg-ink-300', 'bg-ink-400', 'bg-ink-600', 'bg-ink-800'] as const;

interface HeatmapDataPoint {
  date: string; // YYYY-MM-DD, a calendar day in the viewer's time zone
  count: number;
}

interface IncidentHeatmapWidgetProps {
  data?: HeatmapDataPoint[];
  variant?: 'dashboard' | 'analytics';
}

const DAY_MS = 86_400_000;
/** The window the server feeds the heatmap: the last 365 days, ending today. */
const WINDOW_DAYS = 365;

/** Today's calendar date in `timeZone`, as milliseconds at that date's UTC midnight. */
function todayInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
}

export function IncidentHeatmapWidget({
  data = [],
  variant = 'dashboard',
}: IncidentHeatmapWidgetProps) {
  const { userTimeZone } = useTimezone();
  const { weeks, monthLabels, totalCount, maxCount, todayMs, windowStartMs } = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach(d => map.set(d.date, (map.get(d.date) || 0) + d.count));

    // Calendar arithmetic on UTC midnights, so the grid is the viewer's days whatever the browser zone.
    const todayMs = todayInZone(userTimeZone);
    const windowStartMs = todayMs - WINDOW_DAYS * DAY_MS;
    // align to Sunday → Saturday (GitHub style)
    const startMs = windowStartMs - new Date(windowStartMs).getUTCDay() * DAY_MS;
    const endMs = todayMs + (6 - new Date(todayMs).getUTCDay()) * DAY_MS;

    const days: { ms: number; count: number }[] = [];
    let total = 0;
    let max = 0;
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const count = map.get(new Date(ms).toISOString().slice(0, 10)) || 0;
      days.push({ ms, count });
      if (ms >= windowStartMs && ms <= todayMs) {
        total += count;
        max = Math.max(max, count);
      }
    }

    const weeks: (typeof days)[] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    const monthLabels = weeks
      .map((week, i) => {
        const d = new Date(week[0].ms);
        return d.getUTCDate() <= 7
          ? { label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), index: i }
          : null;
      })
      .filter(Boolean) as { label: string; index: number }[];

    return {
      weeks,
      monthLabels,
      totalCount: total,
      maxCount: max || 1,
      todayMs,
      windowStartMs,
    };
  }, [data, userTimeZone]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // On narrow screens the grid scrolls horizontally; start at the most recent weeks.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  }, [weeks]);

  const getColor = useCallback(
    (count: number) => {
      if (count === 0) return HEAT_LEVELS[0];
      const v = count / Math.max(maxCount, 4);
      return HEAT_LEVELS[v <= 0.25 ? 1 : v <= 0.5 ? 2 : v <= 0.75 ? 3 : 4];
    },
    [maxCount]
  );

  return (
    <TooltipProvider>
      <div
        className={cn(
          'group relative overflow-hidden p-4 sm:p-5',
          variant === 'dashboard'
            ? 'rounded-lg border border-border bg-card shadow-xs'
            : 'rounded-lg border border-border bg-muted/40'
        )}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground"
              aria-hidden
            >
              <Activity className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="dash-heading-sm">Incident activity</h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                {totalCount.toLocaleString()} incidents in the last {WINDOW_DAYS} days
              </p>
            </div>
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">
            Peak <span className="font-semibold text-foreground">{maxCount} / day</span>
          </div>
        </div>

        <div ref={scrollRef} className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
          <div className="min-w-160">
            {/* Month labels */}
            <div
              className="grid mb-2 text-xs font-medium text-muted-foreground"
              style={{
                gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
              }}
            >
              {monthLabels.map((m, i) => (
                <div key={i} style={{ gridColumnStart: m.index + 1 }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* Heatmap */}
            <div
              className="grid grid-rows-7 grid-flow-col gap-[1.5px] sm:gap-[2px]"
              style={{
                gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
              }}
            >
              {weeks.map((week, w) =>
                week.map((day, d) => (
                  <Tooltip key={`${w}-${d}`} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          'cursor-pointer rounded-[1.5px] transition-shadow duration-150 hover:ring-1 hover:ring-ring',
                          getColor(day.count),
                          (day.ms > todayMs || day.ms < windowStartMs) && 'opacity-35'
                        )}
                        style={{
                          aspectRatio: '1 / 1',
                          minWidth: '6px',
                          minHeight: '6px',
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent className="text-xs font-medium tabular-nums">
                      <span className="font-semibold">{day.count}</span> incident
                      {day.count === 1 ? '' : 's'} ·{' '}
                      {new Date(day.ms).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </TooltipContent>
                  </Tooltip>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-end gap-2 text-2xs text-muted-foreground">
          <span>Fewer</span>
          <div className="flex items-center gap-1" aria-hidden>
            {HEAT_LEVELS.map(level => (
              <div key={level} className={cn('h-2.5 w-2.5 rounded-[1.5px]', level)} />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
