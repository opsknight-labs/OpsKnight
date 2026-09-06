'use client';

import { ReactNode, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
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
  const sizeClasses = {
    compact: 'p-2',
    normal: 'p-3',
    large: 'p-4',
  };

  return (
    <Card className={`h-full flex flex-col overflow-hidden ${className}`}>
      <CardHeader
        className={`${sizeClasses[size]} pb-2 flex flex-row items-center justify-between gap-2 border-b border-border/50`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditing && (
            <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          <CardTitle className="text-sm font-medium truncate">{title}</CardTitle>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
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
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              title="Remove widget"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className={`flex-1 ${sizeClasses[size]} pt-2 overflow-auto`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <span className="text-xs">Loading...</span>
            </div>
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
