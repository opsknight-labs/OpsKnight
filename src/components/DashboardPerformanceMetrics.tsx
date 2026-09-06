'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type PerformanceMetricsProps = {
  mtta: number | null; // in minutes
  mttr: number | null; // in minutes
  ackSlaRate: number; // percentage
  resolveSlaRate: number; // percentage
  mttaTrend?: 'up' | 'down' | 'neutral';
  mttrTrend?: 'up' | 'down' | 'neutral';
  previousMtta?: number | null;
  previousMttr?: number | null;
};

// Simple formatting functions don't need useCallback - they're lightweight
const formatTime = (minutes: number | null) => {
  if (minutes === null || minutes === 0) return '--';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatTimeForDisplay = (minutes: number | null, color?: string) => {
  if (minutes === null || minutes === 0) return <span style={{ color }}>--</span>;
  if (minutes < 60) {
    return <span style={{ color }}>{Math.round(minutes)}m</span>;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins > 0) {
    return (
      <div className="flex flex-col leading-tight">
        <span style={{ color }}>{hours}h</span>
        <span style={{ color }}>{mins}m</span>
      </div>
    );
  }
  return <span style={{ color }}>{hours}h</span>;
};

export default function DashboardPerformanceMetrics({
  mtta,
  mttr,
  ackSlaRate,
  resolveSlaRate,
  mttaTrend = 'neutral',
  mttrTrend = 'neutral',
  previousMtta,
  previousMttr,
}: PerformanceMetricsProps) {
  // Memoize trend indicator calculations
  const { mttaTrendData, mttrTrendData } = useMemo(() => {
    const getTrendIndicator = (
      current: number | null,
      previous: number | null,
      trend?: 'up' | 'down' | 'neutral'
    ) => {
      if (!current || !previous) return null;
      const change = current - previous;
      const percentChange = Math.abs((change / previous) * 100);

      if (trend === 'up' || change > 0) {
        return {
          icon: <TrendingUp className="h-3 w-3" />,
          color: 'text-red-600',
          text: `+${formatTime(Math.abs(change))} (+${percentChange.toFixed(1)}%)`,
        };
      } else if (trend === 'down' || change < 0) {
        return {
          icon: <TrendingDown className="h-3 w-3" />,
          color: 'text-green-600',
          text: `-${formatTime(Math.abs(change))} (-${percentChange.toFixed(1)}%)`,
        };
      }
      return null;
    };

    return {
      mttaTrendData: getTrendIndicator(mtta, previousMtta ?? null, mttaTrend),
      mttrTrendData: getTrendIndicator(mttr, previousMttr ?? null, mttrTrend),
    };
  }, [mtta, mttr, previousMtta, previousMttr, mttaTrend, mttrTrend]);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* MTTA */}
      <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
            MTTA
          </div>
          <span className="text-[0.7rem] text-muted-foreground">Mean Time to Acknowledge</span>
        </div>
        <div className="text-[1.75rem] font-bold text-red-600 mb-1">{formatTime(mtta)}</div>
        {mttaTrendData && (
          <div
            className={cn(
              'text-[0.7rem] font-semibold flex items-center gap-1',
              mttaTrendData.color
            )}
          >
            {mttaTrendData.icon}
            <span>{mttaTrendData.text}</span>
          </div>
        )}
      </div>

      {/* MTTR */}
      <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
            MTTR
          </div>
          <span className="text-[0.7rem] text-muted-foreground">Mean Time to Resolve</span>
        </div>
        <div className="text-[1.75rem] font-bold mb-1">{formatTimeForDisplay(mttr, '#16a34a')}</div>
        {mttrTrendData && (
          <div
            className={cn(
              'text-[0.7rem] font-semibold flex items-center gap-1',
              mttrTrendData.color
            )}
          >
            {mttrTrendData.icon}
            <span>{mttrTrendData.text}</span>
          </div>
        )}
      </div>

      {/* Ack SLA */}
      <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
          Acknowledge SLA
        </div>
        <div
          className={cn(
            'text-2xl font-bold mb-0.5',
            ackSlaRate >= 95
              ? 'text-green-600'
              : ackSlaRate >= 80
                ? 'text-orange-500'
                : 'text-red-600'
          )}
        >
          {ackSlaRate.toFixed(1)}%
        </div>
        <div className="text-xs text-muted-foreground">
          {ackSlaRate >= 95 ? 'Excellent' : ackSlaRate >= 80 ? 'Good' : 'Needs Improvement'}
        </div>
      </div>

      {/* Resolve SLA */}
      <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
          Resolve SLA
        </div>
        <div
          className={cn(
            'text-2xl font-bold mb-0.5',
            resolveSlaRate >= 95
              ? 'text-green-600'
              : resolveSlaRate >= 80
                ? 'text-orange-500'
                : 'text-red-600'
          )}
        >
          {resolveSlaRate.toFixed(1)}%
        </div>
        <div className="text-xs text-muted-foreground">
          {resolveSlaRate >= 95 ? 'Excellent' : resolveSlaRate >= 80 ? 'Good' : 'Needs Improvement'}
        </div>
      </div>
    </div>
  );
}
