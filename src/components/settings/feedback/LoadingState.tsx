'use client';

import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { cn } from '@/lib/utils';

interface LoadingStateProps {
  variant?: 'form' | 'card' | 'list' | 'table';
  rows?: number;
  className?: string;
}

export function LoadingState({ variant = 'form', rows = 3, className }: LoadingStateProps) {
  if (variant === 'form') {
    return (
      <div className={cn('space-y-6', className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" /> {/* Label */}
            <Skeleton className="h-10 w-full" /> {/* Input */}
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={cn('space-y-4', className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className={cn('space-y-3', className)}>
        <Skeleton className="h-10 w-full" /> {/* Header */}
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return null;
}

// Specific loading states for common settings patterns
export function SettingsFormLoading({ sections = 2 }: { sections?: number }) {
  return (
    <div className="space-y-8">
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="space-y-4">
          <div>
            <Skeleton className="h-6 w-32 mb-2" /> {/* Section title */}
            <Skeleton className="h-4 w-64" /> {/* Section description */}
          </div>
          <Skeleton className="h-px w-full" /> {/* Separator */}
          <LoadingState variant="form" rows={3} />
        </div>
      ))}
    </div>
  );
}
