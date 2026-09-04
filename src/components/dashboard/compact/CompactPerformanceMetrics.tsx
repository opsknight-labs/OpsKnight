'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import SparklineChart from '../SparklineChart';

interface CompactPerformanceMetricsProps {
  mtta: number | null;
  mttr: number | null;
  ackSlaRate: number | null;
  resolveSlaRate: number | null;
  /** Optional 7-day historical MTTA data for sparkline */
  mttaHistory?: number[];
  /** Optional 7-day historical MTTR data for sparkline */
  mttrHistory?: number[];
}

/**
 * Safely formats a time value in minutes to a human-readable string
 */
function formatTime(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return 'N/A';
  if (!Number.isFinite(minutes) || minutes < 0) return 'N/A';
  if (minutes < 1) return '<1m';

  const rounded = Math.round(minutes);
  if (rounded >= 60) {
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${rounded}m`;
}

/**
 * Gets the status color class based on SLA compliance rate
 */
function getStatusClass(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return 'text-muted-foreground';
  }
  if (rate >= 95) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 80) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Gets the progress bar color class based on SLA compliance rate
 */
function getProgressBarClass(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return 'bg-muted';
  }
  if (rate >= 95) return 'bg-emerald-500';
  if (rate >= 80) return 'bg-amber-500';
  return 'bg-red-500';
}

/**
 * Safely formats a percentage value
 */
function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return 'N/A';
  }
  // Clamp to 0-100 range
  const clamped = Math.max(0, Math.min(100, rate));
  return `${Math.round(clamped)}%`;
}

/**
 * Compact Performance Metrics Widget
 * Displays MTTA, MTTR, and SLA compliance rates with progress bars and sparklines
 */
const CompactPerformanceMetrics = memo(function CompactPerformanceMetrics({
  mtta,
  mttr,
  ackSlaRate,
  resolveSlaRate,
  mttaHistory,
  mttrHistory,
}: CompactPerformanceMetricsProps) {
  const timeMetrics = useMemo(
    () => [
      {
        label: 'MTTA',
        value: formatTime(mtta),
        description: 'Mean Time to Acknowledge',
        history: mttaHistory,
        color: '#3b82f6',
      },
      {
        label: 'MTTR',
        value: formatTime(mttr),
        description: 'Mean Time to Resolve',
        history: mttrHistory,
        color: '#8b5cf6',
      },
    ],
    [mtta, mttr, mttaHistory, mttrHistory]
  );

  const slaMetrics = useMemo(
    () => [
      {
        label: 'ACK SLA',
        value: formatPercent(ackSlaRate),
        rate: ackSlaRate,
        className: getStatusClass(ackSlaRate),
        barClass: getProgressBarClass(ackSlaRate),
        description: 'Acknowledgment SLA Compliance',
      },
      {
        label: 'Resolve SLA',
        value: formatPercent(resolveSlaRate),
        rate: resolveSlaRate,
        className: getStatusClass(resolveSlaRate),
        barClass: getProgressBarClass(resolveSlaRate),
        description: 'Resolution SLA Compliance',
      },
    ],
    [ackSlaRate, resolveSlaRate]
  );

  return (
    <div className="space-y-3" role="list" aria-label="Performance metrics">
      {/* Time Metrics Row */}
      <div className="grid grid-cols-2 gap-2.5">
        {timeMetrics.map((metric, idx) => (
          <div
            key={idx}
            className="p-2.5 px-3 rounded-md bg-muted/40 border border-border overflow-hidden"
            role="listitem"
            aria-label={`${metric.description}: ${metric.value}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                {metric.label}
              </span>
              {metric.history && metric.history.length >= 2 && (
                <SparklineChart
                  data={metric.history}
                  width={50}
                  height={16}
                  color={metric.color}
                  strokeWidth={1.5}
                />
              )}
            </div>
            <div className="text-lg font-bold leading-tight tabular-nums text-foreground">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      {/* SLA Metrics with Progress Bars */}
      <div className="space-y-2">
        {slaMetrics.map((metric, idx) => (
          <div
            key={idx}
            className="p-2.5 px-3 rounded-md bg-muted/40 border border-border"
            role="listitem"
            aria-label={`${metric.description}: ${metric.value}`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                {metric.label}
              </span>
              <span className={cn('text-sm font-bold tabular-nums', metric.className)}>
                {metric.value}
              </span>
            </div>
            {/* Progress Bar */}
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', metric.barClass)}
                style={{
                  width: `${Math.max(0, Math.min(100, metric.rate ?? 0))}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default CompactPerformanceMetrics;
