import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronsLeft } from 'lucide-react';
import RelativeTime from '@/components/patterns/RelativeTime';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/timezone';

/**
 * Pieces shared by the alerts and changes lists. Server-renderable (the relative time is a client leaf).
 */

/** In the viewer's time zone, labelled, as the other lists show times. */
export const formatListWhen = (date: Date, timeZone: string) =>
  formatDateTime(date, timeZone, { includeTimeZone: true });

export function ListWhen({ value, timeZone }: { value: Date; timeZone: string }) {
  return (
    <time dateTime={value.toISOString()} className="whitespace-nowrap">
      {formatListWhen(value, timeZone)}
    </time>
  );
}

/** Received/occurred time for a table cell: how long ago, with the exact UTC time underneath. */
export function ListWhenCell({ value, timeZone }: { value: Date; timeZone: string }) {
  return (
    <span className="flex flex-col">
      <RelativeTime date={value} className="text-sm text-foreground" />
      <span className="text-xs text-muted-foreground tabular-nums">
        <ListWhen value={value} timeZone={timeZone} />
      </span>
    </span>
  );
}

export type ChipTone = 'neutral' | 'critical' | 'elevated' | 'info' | 'ok' | 'shift' | 'outline';

/** A small labelled chip. The label carries the meaning; colour only reinforces it. */
export function ListChip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'outline'
          ? 'border-dashed border-border bg-transparent text-muted-foreground'
          : toneClasses(tone).soft
      )}
    >
      {children}
    </span>
  );
}

export const listLinkClass =
  'inline-flex min-h-11 items-center wrap-break-word font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/** Secondary link inside a row (service, incident): muted, underlined on hover. */
export const listSubLinkClass =
  'wrap-break-word rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Forward-only keyset pagination, as the footer of the list card: the cursor lives in the URL, so a page
 * is a shareable link.
 */
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
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"
    >
      <p className="text-xs text-muted-foreground tabular-nums">
        Showing {shown} {shown === 1 ? 'row' : 'rows'}, newest first.
      </p>
      <div className="flex gap-2">
        {!onFirstPage && (
          <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
            <Link href={firstHref}>
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              First page
            </Link>
          </Button>
        )}
        {nextHref && (
          <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
            <Link href={nextHref} rel="next">
              Next page
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
