'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/timezone';
import { RelativeTime } from '@/components/patterns';
import TablePaginationFooter, {
  type TablePaginationFooterProps,
} from '@/components/ui/TablePaginationFooter';

/*
 * The log-table pattern shared by Audit log, Event logs and System logs:
 * FilterBar → LogTableCard (table or EmptyState) → LogPagination.
 */

/** Column header cell: DESIGN.md DataTable header. */
export const logHeadClass =
  'h-10 px-4 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
/** Body cell. */
export const logCellClass = 'px-4 py-3 align-top text-sm';
/** Body row. */
export const logRowClass = 'border-b border-border transition-colors hover:bg-muted/50';

/** Card that holds the table (or its empty state) and the pagination footer. */
export function LogTableCard({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        className
      )}
    >
      {children}
      {footer}
    </div>
  );
}

/** Horizontal scroll wrapper for wide log tables; keyboard-focusable so it can be scrolled. */
export function LogTableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto [-webkit-overflow-scrolling:touch] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {children}
    </div>
  );
}

/** Relative time ("5m ago", absolute on hover) with the absolute time underneath for scanning. */
export function LogTimestamp({
  date,
  timeZone,
  className,
}: {
  date: Date | string;
  timeZone: string;
  className?: string;
}) {
  const absolute = formatDateTime(date, timeZone, { format: 'datetime' });
  return (
    <div className={cn('whitespace-nowrap', className)}>
      <RelativeTime
        date={date}
        timeZone={timeZone}
        format="long"
        className="text-sm font-medium text-foreground"
      />
      <div className="text-xs tabular-nums text-muted-foreground">{absolute}</div>
    </div>
  );
}

/** Monospace identifier with an optional copy button (named for screen readers). */
export function MonoId({
  value,
  label = 'ID',
  display,
  copyable = true,
  className,
}: {
  value: string;
  /** What the id is, e.g. "event ID"; used in the copy button's name. */
  label?: string;
  /** Shortened form shown in dense rows; the full value is copied and in `title`. */
  display?: string;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className={cn('inline-flex max-w-full items-center gap-1', className)}>
      <code
        title={value}
        className="truncate font-mono text-xs text-muted-foreground"
        translate="no"
      >
        {display ?? value}
      </code>
      {copyable && (
        <button
          type="button"
          data-icon-button
          onClick={copy}
          aria-label={copied ? `${label} copied` : `Copy ${label} ${value}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <Check
              className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
          ) : (
            <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
        </button>
      )}
    </span>
  );
}

/** Pagination footer inside a labelled `nav` landmark. */
export function LogPagination({ label, ...props }: TablePaginationFooterProps & { label: string }) {
  return (
    <nav aria-label={label}>
      <TablePaginationFooter {...props} />
    </nav>
  );
}
