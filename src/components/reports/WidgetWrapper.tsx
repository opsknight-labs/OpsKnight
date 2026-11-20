'use client';

import { ReactNode, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { GripVertical, Settings, X, Maximize2 } from 'lucide-react';

type WidgetWrapperProps = {
  title: string;
  children: ReactNode;
  isEditing?: boolean;
  isLoading?: boolean;
  error?: string | null;
  size?: 'compact' | 'normal' | 'large';
  onRemove?: () => void;
  onConfigure?: () => void;
  onExpand?: () => void;
  className?: string;
};

/**
 * WidgetWrapper - Container component for dashboard widgets
 *
 * Features:
 * - Consistent styling across all widget types
 * - Edit mode with drag handle, configure, and remove buttons
 * - Loading and error states
 * - Size variants
 */
const WidgetWrapper = memo(function WidgetWrapper({
  title,
  children,
  isEditing = false,
  isLoading = false,
  error = null,
  size = 'normal',
  onRemove,
  onConfigure,
  onExpand,
  className = '',
}: WidgetWrapperProps) {
  const getSizeClass = (s: 'compact' | 'normal' | 'large'): string => {
    switch (s) {
      case 'compact':
        return 'p-2';
      case 'large':
        return 'p-4';
      default:
        return 'p-3';
    }
  };

  return (
    <Card className={`h-full flex flex-col overflow-hidden ${className}`}>
      <CardHeader
        className={`${getSizeClass(size)} pb-2 flex flex-row items-center justify-between gap-2 border-b border-border/50`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditing && (
            <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          <CardTitle className="text-sm font-medium truncate">{title}</CardTitle>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 relative z-20">
          {onExpand && !isEditing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onExpand}
              title="Expand"
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}
          {isEditing && onConfigure && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onConfigure}
              title="Configure widget"
            >
              <Settings className="h-3 w-3" />
            </Button>
          )}
          {isEditing && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 p-0 rounded-full bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200/80 hover:border-rose-200 transition-colors cursor-pointer dark:bg-zinc-800 dark:hover:bg-rose-950/40 dark:text-zinc-400 dark:hover:text-rose-400 dark:border-zinc-700"
              onClick={onRemove}
              title="Remove widget"
              aria-label="Remove widget"
            >
              <X className="h-3.5 w-3.5 stroke-[2.25]" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className={`flex-1 ${getSizeClass(size)} pt-2 overflow-auto`}>
        {isLoading ? (
          <div role="status" aria-busy="true" className="flex h-full min-h-24 flex-col gap-2">
            <span className="sr-only">Loading widget</span>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="w-full flex-1 rounded-md" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-destructive">
              <span className="text-xs">{error}</span>
            </div>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
});

export default WidgetWrapper;
