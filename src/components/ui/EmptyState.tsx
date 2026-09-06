import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  variant?: 'dashed' | 'card' | 'simple';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export default function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'dashed',
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center transition-all',
        variant === 'dashed' &&
          'rounded-xl border border-dashed border-border/80 bg-muted/20 hover:bg-muted/30',
        variant === 'card' && 'rounded-xl border border-border bg-card shadow-2xs',
        variant === 'simple' && 'p-4',
        size === 'sm' && 'p-6 gap-2',
        size === 'md' && 'p-8 sm:p-10 gap-3',
        size === 'lg' && 'p-12 sm:p-16 gap-4',
        className
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-2xl bg-muted text-muted-foreground transition-colors',
            size === 'sm' && 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5',
            size === 'md' && 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6',
            size === 'lg' && 'h-16 w-16 [&>svg]:h-8 [&>svg]:w-8'
          )}
        >
          {icon}
        </div>
      )}

      <div className="max-w-md space-y-1">
        <h3
          className={cn(
            'font-semibold text-foreground tracking-tight',
            size === 'sm' && 'text-xs sm:text-sm',
            size === 'md' && 'text-sm sm:text-base',
            size === 'lg' && 'text-base sm:text-lg'
          )}
        >
          {title}
        </h3>

        {description && (
          <div
            className={cn(
              'text-muted-foreground leading-relaxed',
              size === 'sm' && 'text-[11px]',
              size === 'md' && 'text-xs sm:text-sm',
              size === 'lg' && 'text-sm'
            )}
          >
            {description}
          </div>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
