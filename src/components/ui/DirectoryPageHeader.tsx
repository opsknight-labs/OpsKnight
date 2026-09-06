import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DirectoryPageHeaderProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  className?: string;
};

export default function DirectoryPageHeader({
  title,
  description,
  badge,
  actions,
  filters,
  className,
}: DirectoryPageHeaderProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Top Title & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <div className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {description}
            </div>
          )}
        </div>

        {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
      </div>

      {/* Optional Filters and Search Bar Row */}
      {filters && <div className="pt-1">{filters}</div>}
    </div>
  );
}
