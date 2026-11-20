'use client';

import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CreateTriggerProps = {
  title: string;
  description?: string;
  onClick: () => void;
  className?: string;
};

/**
 * Compact dashed "Create …" row that opens an inline create form on list pages
 * (services, teams, schedules, policies). One row, about 60px tall.
 */
export default function CreateTrigger({
  title,
  description,
  onClick,
  className,
}: CreateTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-primary/35 bg-primary/[0.04] px-4 py-2.5 text-left shadow-sm',
        'transition-colors duration-150 hover:border-primary/70 hover:bg-primary/[0.08]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform duration-150 group-hover:scale-105 motion-reduce:transform-none"
      >
        <Plus className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className="hidden shrink-0 items-center gap-0.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors duration-150 group-hover:bg-primary/90 sm:inline-flex"
      >
        Create
        <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none" />
      </span>
    </button>
  );
}
