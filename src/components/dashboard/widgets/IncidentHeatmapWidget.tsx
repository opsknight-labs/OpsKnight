'use client';

import { useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';

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
  const router = useRouter();

  const handleDayClick = useCallback(
    (dayDate: Date) => {
      if (variant !== 'dashboard') return;
      const y = dayDate.getFullYear();
      const m = String(dayDate.getMonth() + 1).padStart(2, '0');
      const d = String(dayDate.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      router.push(`/?startDate=${dateStr}&endDate=${dateStr}&range=custom`, { scroll: false });
    },
    [router, variant]
  );

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

  const getColor = useCallback(
    (count: number) => {
      if (count === 0) return 'bg-slate-200 dark:bg-slate-800';
      const scale = Math.max(maxCount, 4);
      const v = count / scale;
      if (v <= 0.25) return 'bg-green-300 dark:bg-green-900';
      if (v <= 0.5) return 'bg-yellow-300 dark:bg-yellow-800';
      if (v <= 0.75) return 'bg-orange-400 dark:bg-orange-700';
      return 'bg-red-500 dark:bg-red-800';
    },
    [maxCount]
  );

  return (
    <TooltipProvider>
      <div
        className={cn(
          'group relative overflow-hidden p-4 sm:p-6',
          variant === 'dashboard'
            ? 'rounded-2xl border border-border bg-card shadow-xs'
            : 'rounded-xl border border-border/50 bg-background/50 shadow-none'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Incident Activity</h3>
              <p className="text-xs text-muted-foreground">
                {totalCount.toLocaleString()} incidents in {year}
              </p>
            </div>
          </div>
        </div>

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
          className="grid grid-rows-7 grid-flow-col gap-[1px] sm:gap-[2px]"
          style={{
            gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
          }}
        >
          {weeks.map((week, w) =>
            week.map((day, d) => (
              <Tooltip key={`${w}-${d}`} delayDuration={0}>
                <TooltipTrigger asChild>
                  <div
                    role={variant === 'dashboard' ? 'button' : undefined}
                    tabIndex={variant === 'dashboard' ? 0 : undefined}
                    onClick={() => handleDayClick(day.date)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleDayClick(day.date);
                      }
                    }}
                    className={cn(
                      'rounded-sm transition-all',
                      getColor(day.count),
                      variant === 'dashboard' &&
                        'cursor-pointer hover:ring-2 hover:ring-primary/60 hover:scale-125 focus:outline-none focus:ring-2 focus:ring-primary'
                    )}
                    style={{
                      aspectRatio: '1 / 1',
                      minWidth: '6px',
                      minHeight: '6px',
                    }}
                    aria-label={`${day.count} incidents on ${day.date.toLocaleDateString()}`}
                  />
                </TooltipTrigger>
                <TooltipContent className="text-xs space-y-0.5">
                  <div className="font-semibold">
                    {day.count} {day.count === 1 ? 'incident' : 'incidents'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {day.date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  {variant === 'dashboard' && (
                    <div className="text-[10px] text-primary font-semibold pt-0.5">
                      Click to view date &rarr;
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-4 text-[10px] text-muted-foreground font-medium">
          <span>Less</span>
          <div className="flex gap-[3px]">
            {/* 0 incidents */}
            <div className={cn('w-3 h-3 rounded-[2px]', 'bg-slate-200 dark:bg-slate-800')} />
            {/* Low intensity (<25%) */}
            <div className={cn('w-3 h-3 rounded-[2px]', 'bg-green-300 dark:bg-green-900')} />
            {/* Medium intensity (<50%) */}
            <div className={cn('w-3 h-3 rounded-[2px]', 'bg-yellow-300 dark:bg-yellow-800')} />
            {/* High intensity (<75%) */}
            <div className={cn('w-3 h-3 rounded-[2px]', 'bg-orange-400 dark:bg-orange-700')} />
            {/* Critical intensity (>75%) */}
            <div className={cn('w-3 h-3 rounded-[2px]', 'bg-red-500 dark:bg-red-800')} />
          </div>
          <span>More</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
