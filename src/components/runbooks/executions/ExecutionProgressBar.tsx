import React from 'react';
import { cn } from '@/lib/utils';

export type ExecutionProgressBarProps = {
  totalSteps: number;
  completedSteps: number;
  status: string;
  className?: string;
  showLabel?: boolean;
};

export function ExecutionProgressBar({
  totalSteps,
  completedSteps,
  status,
  className,
  showLabel = true,
}: ExecutionProgressBarProps) {
  if (totalSteps <= 0) return null;

  const percentage = Math.min(100, Math.max(0, Math.round((completedSteps / totalSteps) * 100)));
  const isRunning = status === 'RUNNING';
  const isFailed = status === 'FAILED' || status === 'TIMED_OUT';
  const isWaiting = status === 'WAITING_APPROVAL' || status === 'WAITING_AGENT';

  return (
    <div className={cn('flex flex-col gap-1 w-full max-w-[180px]', className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>
            {completedSteps}/{totalSteps} steps
          </span>
          <span>{percentage}%</span>
        </div>
      )}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isFailed
              ? 'bg-rose-500'
              : isWaiting
                ? 'bg-amber-500'
                : isRunning
                  ? 'bg-blue-500'
                  : 'bg-emerald-500'
          )}
          style={{ width: `${percentage}%` }}
        />
        {isRunning && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-white/20 animate-pulse rounded-full"
          />
        )}
      </div>
    </div>
  );
}
