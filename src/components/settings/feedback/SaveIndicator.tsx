'use client';

import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { type SaveStatus } from '@/lib/hooks/use-autosave';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';

interface SaveIndicatorProps {
  status: SaveStatus;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function SaveIndicator({ status, error, onRetry, className }: SaveIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm transition-all duration-200',
        status === 'saving' && 'text-muted-foreground',
        status === 'saved' && 'text-emerald-600 dark:text-emerald-400',
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
          {onRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-7 gap-1 px-2 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
          )}
        </>
      )}
    </div>
  );
}
