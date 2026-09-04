'use client';

import { useMemo, useCallback } from 'react';
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
      if (count === 0) return 'bg-slate-100 hover:bg-slate-200 border border-slate-200/60';
      const scale = Math.max(maxCount, 4);
      const v = count / scale;
      if (v <= 0.25) return 'bg-emerald-100 hover:bg-emerald-200 border border-emerald-200/70';
      if (v <= 0.5) return 'bg-emerald-300 hover:bg-emerald-400 border border-emerald-400/70';
      if (v <= 0.75) return 'bg-amber-300 hover:bg-amber-400 border border-amber-400/70';
      return 'bg-rose-500 hover:bg-rose-600 shadow-2xs';
    },
    [maxCount]
  );

  return (
    <TooltipProvider>
      <div
        className={cn(
          'group relative overflow-hidden p-4 sm:p-5',
          variant === 'dashboard'
            ? 'rounded-xl border border-slate-200 bg-white shadow-xs'
            : 'rounded-xl border border-slate-200 bg-slate-50 shadow-none'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Incident Activity</h3>
              <p className="text-[11px] text-slate-500 font-medium">
                {totalCount.toLocaleString()} incidents in {year}
              </p>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 font-medium bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200/80">
            Peak: <span className="font-bold text-slate-800">{maxCount} / day</span>
          </div>
        </div>

        {/* Month labels */}
        <div
          className="grid mb-2 text-xs font-medium text-slate-500"
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
                      'rounded-[2px] transition-transform hover:scale-125 cursor-pointer',
                      getColor(day.count)
                    )}
                    style={{
                      aspectRatio: '1 / 1',
                      minWidth: '6px',
                      minHeight: '6px',
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent className="text-xs font-medium bg-slate-900 text-white shadow-lg border-slate-800">
                  <span className="font-bold">{day.count}</span> incident
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

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-3.5 text-[10px] text-slate-500 font-medium">
          <span>Fewer</span>
          <div className="flex gap-1 items-center">
            {/* 0 incidents */}
            <div className="w-2.5 h-2.5 rounded-[2px] bg-slate-100 border border-slate-200/60" />
            {/* Low intensity (<25%) */}
            <div className="w-2.5 h-2.5 rounded-[2px] bg-emerald-100 border border-emerald-200/70" />
            {/* Medium intensity (<50%) */}
            <div className="w-2.5 h-2.5 rounded-[2px] bg-emerald-300 border border-emerald-400/70" />
            {/* High intensity (<75%) */}
            <div className="w-2.5 h-2.5 rounded-[2px] bg-amber-300 border border-amber-400/70" />
            {/* Critical intensity (>75%) */}
            <div className="w-2.5 h-2.5 rounded-[2px] bg-rose-500 shadow-2xs" />
          </div>
          <span>More</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
