'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type TrendDirection = 'up' | 'down' | 'stable';

type TrendIndicatorProps = {
  current: number | null;
  previous: number | null;
  /** If true, lower is better (e.g., MTTR) */
  lowerIsBetter?: boolean;
  showPercentage?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * Trend indicator showing direction and percentage change
 */
export default function TrendIndicator({
  current,
  previous,
  lowerIsBetter = true,
  showPercentage = true,
  size = 'sm',
  className,
}: TrendIndicatorProps) {
  if (
    current === null ||
    previous === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}>
        <Minus className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
      </span>
    );
  }

  if (previous === 0) {
    if (current === 0) {
      return (
        <span className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}>
          <Minus className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
        </span>
      );
    }
    const isUp = current > 0;
    const isGood = lowerIsBetter ? !isUp : isUp;
    const colorClass = isGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
    const Icon = isUp ? TrendingUp : TrendingDown;
    return (
      <span className={cn('inline-flex items-center gap-1 font-medium', colorClass, className)}>
        <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
        {showPercentage && <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>+100%</span>}
      </span>
    );
  }

  const percentChange = ((current - previous) / Math.abs(previous)) * 100;
  const absoluteChange = Math.abs(Math.round(percentChange));

  let direction: TrendDirection;
  if (Math.abs(percentChange) < 5) {
    direction = 'stable';
  } else if (percentChange > 0) {
    direction = 'up';
  } else {
    direction = 'down';
  }

  // Determine if trend is good or bad
  const isGood =
    direction === 'stable' ||
    (lowerIsBetter && direction === 'down') ||
    (!lowerIsBetter && direction === 'up');

  const colorClass = isGood
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';

  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <span
      className={cn('inline-flex items-center gap-0.5 font-medium', colorClass, className)}
      title={`${direction === 'up' ? '+' : direction === 'down' ? '-' : ''}${absoluteChange}% vs previous period`}
    >
      <Icon className={iconSize} />
      {showPercentage && direction !== 'stable' && (
        <span className={textSize}>{absoluteChange}%</span>
      )}
    </span>
  );
}
