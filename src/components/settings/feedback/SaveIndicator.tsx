'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { type SaveStatus } from '@/lib/hooks/use-autosave';
import { cn } from '@/lib/utils';

interface SaveIndicatorProps {
  status: SaveStatus;
  error?: string | null;
  className?: string;
}

export function SaveIndicator({ status, error, className }: SaveIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm transition-all duration-200',
        status === 'saving' && 'text-muted-foreground',
        status === 'saved' && 'text-green-600 dark:text-green-400',
        status === 'error' && 'text-destructive',
        className
      )}
      role="status"
      aria-live="polite"
    >
      {status === 'saving' && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <CheckCircle2 className="h-4 w-4" />
          <span>Saved</span>
        </>
      )}

      {status === 'error' && (
        <>
          <XCircle className="h-4 w-4" />
          <span>{error || 'Failed to save'}</span>
        </>
      )}
    </div>
  );
}
