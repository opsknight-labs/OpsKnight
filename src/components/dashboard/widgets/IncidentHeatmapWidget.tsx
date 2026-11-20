'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';
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
  date: string; // YYYY-MM-DD
  count: number;
}

interface IncidentHeatmapWidgetProps {
  data?: HeatmapDataPoint[];
  year?: number;
  variant?: 'dashboard' | 'analytics';
}

export function IncidentHeatmapWidget({
  data = [],
  year = new Date().getFullYear(),
  variant = 'dashboard',
}: IncidentHeatmapWidgetProps) {
  const { weeks, monthLabels, totalCount, maxCount } = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    let max = 0;

    data.forEach(d => {
      const v = (map.get(d.date) || 0) + d.count;
      map.set(d.date, v);
      total += d.count;
      max = Math.max(max, v);
    });

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);

    // align to Sunday → Saturday (GitHub style)
    start.setDate(start.getDate() - start.getDay());
    end.setDate(end.getDate() + (6 - end.getDay()));

    const days: { date: Date; count: number }[] = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, '0');
      const day = String(cursor.getDate()).padStart(2, '0');
      const key = `${year}-${month}-${day}`;
      days.push({
        date: new Date(cursor),
        count: map.get(key) || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const weeks: (typeof days)[] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    const monthLabels = weeks
      .map((week, i) => {
        const d = week[0].date;
        return d.getDate() <= 7
          ? { label: d.toLocaleString('en-US', { month: 'short' }), index: i }
          : null;
      })
      .filter(Boolean) as { label: string; index: number }[];

    return {
      weeks,
      monthLabels,
      totalCount: total,
      maxCount: max || 1,
    };
  }, [data, year]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // On narrow screens the year scrolls horizontally; start at the most recent weeks.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const now = Date.now();
    const current = weeks.findIndex(week => week[week.length - 1].date.getTime() >= now);
    const anchor = current === -1 ? weeks.length : current + 1;
    el.scrollLeft = Math.max(0, (anchor / weeks.length) * el.scrollWidth - el.clientWidth + 16);
  }, [weeks]);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

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
            ? 'rounded-lg border border-border bg-card shadow-sm'
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
                {totalCount.toLocaleString()} incidents in {year}
              </p>
            </div>
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">
            Peak <span className="font-semibold text-foreground">{maxCount} / day</span>
          </div>
        </div>

        <div ref={scrollRef} className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          <div className="min-w-[40rem]">
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
                          day.date > today && 'opacity-35'
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
                      {day.date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
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
