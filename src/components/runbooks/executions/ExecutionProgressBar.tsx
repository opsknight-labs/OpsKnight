import React from 'react';
import { cn } from '@/lib/utils';

export type ExecutionProgressBarProps = {
  totalSteps: number;
  completedSteps: number;
  status: string;
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'lg';
};

export function ExecutionProgressBar({
  totalSteps,
  completedSteps,
  status,
  className,
  showLabel = true,
  size = 'sm',
}: ExecutionProgressBarProps) {
  if (totalSteps <= 0) return null;

  const percentage = Math.min(100, Math.max(0, Math.round((completedSteps / totalSteps) * 100)));
  const isRunning = status === 'RUNNING';
  const isFailed = status === 'FAILED' || status === 'TIMED_OUT';
  const isWaiting = status === 'WAITING_APPROVAL' || status === 'WAITING_AGENT';
  const isMuted = status === 'CANCELLED' || status === 'CANCEL_REQUESTED' || status === 'QUEUED';
  const large = size === 'lg';

  return (
    <div className={cn('flex w-full flex-col gap-1', large ? 'gap-2' : 'max-w-[180px]', className)}>
      {showLabel && (
        <div
          className={cn(
            'flex items-baseline justify-between font-medium text-muted-foreground tabular-nums',
            large ? 'text-xs' : 'text-[11px]'
          )}
        >
          <span>
            {large ? (
              <>
                <span className="text-sm font-semibold text-foreground">{completedSteps}</span> of{' '}
                {totalSteps} steps complete
              </>
            ) : (
              <>
                {completedSteps}/{totalSteps} steps
              </>
            )}
          </span>
          <span className={cn(large && 'text-sm font-semibold text-foreground')}>
            {percentage}%
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label="Execution progress"
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        aria-valuenow={completedSteps}
        aria-valuetext={`${completedSteps} of ${totalSteps} steps complete`}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-muted',
          large ? 'h-2.5' : 'h-1.5'
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            isFailed
              ? 'bg-rose-500'
              : isWaiting
                ? 'bg-amber-500'
                : isRunning
                  ? 'bg-blue-500'
                  : isMuted
                    ? 'bg-muted-foreground/40'
                    : 'bg-emerald-500'
          )}
          style={{ width: `${percentage}%` }}
        />
        {isRunning && (
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-pulse rounded-full bg-white/20"
          />
        )}
      </div>
    </div>
  );
}
