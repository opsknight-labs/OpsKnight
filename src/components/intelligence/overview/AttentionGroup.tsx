'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One inbox row standing for several insights of the same kind ("6 schedules: …"). The disclosure reveals
 * the individual rows, each with its own decide controls; they stay rendered so their state survives a
 * collapse.
 */
export default function AttentionGroup({
  badge,
  title,
  description,
  children,
}: {
  badge: ReactNode;
  title: string;
  description: string;
  /** The individual rows, as `<li>` elements. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <li data-attention-group>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            {badge}
            <span className="min-w-0 wrap-break-word text-sm font-medium text-foreground">{title}</span>
          </span>
          <span className="line-clamp-2 wrap-break-word text-sm text-muted-foreground">
            {description}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium text-muted-foreground">
          {open ? 'Hide' : 'Show'}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'h-4 w-4 transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-90'
            )}
          />
        </span>
      </button>
      <ul
        id={listId}
        hidden={!open}
        className="divide-y divide-border border-t border-border bg-muted/30"
      >
        {children}
      </ul>
    </li>
  );
}
