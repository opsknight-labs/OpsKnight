import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Pieces shared by the alerts and changes lists. Server-renderable: no client JavaScript.
 */

export const formatListWhen = (date: Date) =>
  `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function ListWhen({ value }: { value: Date }) {
  return (
    <time dateTime={value.toISOString()} className="whitespace-nowrap">
      {formatListWhen(value)}
    </time>
  );
}

export type ChipTone = 'neutral' | 'critical' | 'elevated' | 'info' | 'ok' | 'shift' | 'outline';

/** A small labelled chip. The label carries the meaning; colour only reinforces it. */
export function ListChip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'border-border bg-muted text-foreground',
        tone === 'outline' && 'border-dashed border-border bg-transparent text-muted-foreground',
        tone === 'critical' &&
          'border-status-critical-border/40 bg-status-critical-soft text-status-critical-deep dark:bg-status-critical/10 dark:text-foreground',
        tone === 'elevated' &&
          'border-status-elevated-border/40 bg-status-elevated-soft text-status-elevated-deep dark:bg-status-elevated/10 dark:text-foreground',
        tone === 'info' &&
          'border-status-info-border/40 bg-status-info-soft text-status-info-deep dark:bg-status-info/10 dark:text-foreground',
        tone === 'ok' &&
          'border-status-ok-border/40 bg-status-ok-soft text-status-ok-deep dark:bg-status-ok/10 dark:text-foreground',
        tone === 'shift' &&
          'border-status-shift-border/40 bg-status-shift-soft text-status-shift-deep dark:bg-status-shift/10 dark:text-foreground'
      )}
    >
      {children}
    </span>
  );
}

export const listLinkClass =
  'inline-flex min-h-11 items-center break-words font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0';

export const listHeadClass =
  'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground';
export const listCellClass = 'px-3 py-2 align-top text-sm';

/** Forward-only keyset pagination: the cursor lives in the URL, so a page is a shareable link. */
export function ListPagination({
  label,
  firstHref,
  nextHref,
  onFirstPage,
  shown,
}: {
  label: string;
  firstHref: string;
  nextHref: string | null;
  onFirstPage: boolean;
  shown: number;
}) {
  if (onFirstPage && !nextHref) return null;
  const linkClass =
    'inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9';
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Showing {shown} {shown === 1 ? 'row' : 'rows'}, newest first.
      </p>
      <div className="flex gap-2">
        {!onFirstPage && (
          <Link href={firstHref} className={linkClass}>
            First page
          </Link>
        )}
        {nextHref && (
          <Link href={nextHref} rel="next" className={linkClass}>
            Next page
          </Link>
        )}
      </div>
    </nav>
  );
}
