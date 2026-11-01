import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { formatDistanceStrict } from 'date-fns';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';

/**
 * Server-rendered building blocks shared by the MCP settings lists: relative time, filter chips,
 * search, pagination and a table that becomes stacked cards on small screens.
 */

export function RelativeTime({
  value,
  now,
  timeZone,
  empty = 'Never',
}: {
  value: Date | null;
  now: Date;
  timeZone: string;
  empty?: string;
}) {
  if (!value) return <span className="whitespace-nowrap text-muted-foreground">{empty}</span>;
  const absolute = formatDateTime(value, timeZone, { includeTimeZone: true });
  return (
    <time dateTime={value.toISOString()} title={absolute} className="whitespace-nowrap">
      {formatDistanceStrict(value, now, { addSuffix: true })}
    </time>
  );
}

export type FilterOption = { value: string; label: string; count?: number; href: string };

/** Segmented filter links. The selected option carries aria-current. */
export function FilterChips({
  label,
  options,
  selected,
}: {
  label: string;
  options: FilterOption[];
  selected: string;
}) {
  return (
    <nav aria-label={label} className="relative min-w-0 overflow-x-auto scrollbar-none">
      <ul className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-muted/50 p-1">
        {options.map(option => {
          const active = option.value === selected;
          return (
            <li key={option.value} className="p-0">
              <Link
                href={option.href}
                aria-current={active ? 'true' : undefined}
                scroll={false}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                )}
              >
                {option.label}
                {option.count !== undefined && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                      active ? 'bg-primary/10 text-primary' : 'bg-muted-foreground/10'
                    )}
                  >
                    {option.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** GET search form that keeps the other filters in hidden fields. */
export function ListSearch({
  id,
  label,
  placeholder,
  value,
  keep,
  clearHref,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  keep: Record<string, string | null | undefined>;
  clearHref: string;
}) {
  return (
    <form role="search" method="get" className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      {Object.entries(keep).map(([name, keepValue]) =>
        keepValue ? <input key={name} type="hidden" name={name} value={keepValue} /> : null
      )}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          name="q"
          type="search"
          maxLength={100}
          defaultValue={value}
          placeholder={placeholder}
          className="h-8 pl-8 text-xs"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" className="h-8 px-3 text-xs">
        Search
      </Button>
      {value && (
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs">
          <Link href={clearHref}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </Link>
        </Button>
      )}
    </form>
  );
}

/** Pages to show around the current one, with gaps as null: 1 … 4 5 6 … 12. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (const [index, n] of sorted.entries()) {
    if (index > 0 && n - sorted[index - 1]! > 1) result.push(null);
    result.push(n);
  }
  return result;
}

export function Pagination({
  label,
  page,
  pageSize,
  total,
  href,
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  // The list's own empty state explains an empty result.
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);
  const linkClass =
    'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const disabledClass =
    'inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border/60 px-2.5 text-xs font-medium text-muted-foreground/60';
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row md:px-6">
      <p aria-live="polite">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            Showing <span className="font-semibold text-foreground">{start}</span>–
            <span className="font-semibold text-foreground">{end}</span> of{' '}
            <span className="font-semibold text-foreground">{total}</span>
          </>
        )}
      </p>
      {pages > 1 && (
        <nav aria-label={label}>
          <ul className="flex items-center gap-1">
            <li className="p-0">
              {page > 1 ? (
                <Link href={href(page - 1)} className={linkClass} rel="prev" scroll={false}>
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </Link>
              ) : (
                <span className={disabledClass} aria-disabled="true">
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </span>
              )}
            </li>
            {pageWindow(page, pages).map((n, index) =>
              n === null ? (
                <li key={`gap-${index}`} className="hidden px-1 sm:block" aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={n} className="hidden p-0 sm:block">
                  <Link
                    href={href(n)}
                    scroll={false}
                    aria-label={`Page ${n}`}
                    aria-current={n === page ? 'page' : undefined}
                    className={cn(
                      linkClass,
                      n === page &&
                        'border-primary/40 bg-primary/10 font-semibold text-primary hover:bg-primary/15'
                    )}
                  >
                    {n}
                  </Link>
                </li>
              )
            )}
            <li className="px-1.5 sm:hidden" aria-current="page">
              {page} / {pages}
            </li>
            <li className="p-0">
              {page < pages ? (
                <Link href={href(page + 1)} className={linkClass} rel="next" scroll={false}>
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : (
                <span className={disabledClass} aria-disabled="true">
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              )}
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}

/**
 * A table on medium screens and up; each row becomes a stacked card below that. One DOM, so
 * assistive technology and tests see the same rows at every width. Cells label themselves on
 * mobile with `data-label`.
 */
export function ResponsiveTable({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: { label: string; className?: string; srOnly?: boolean }[];
  children: ReactNode;
}) {
  return (
    <table role="table" className="block w-full border-collapse text-sm md:table">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only md:not-sr-only" role="rowgroup">
        <tr role="row" className="border-b border-border bg-muted/30">
          {columns.map(column => (
            <th
              key={column.label}
              role="columnheader"
              scope="col"
              className={cn(
                // Inner spans carry the type size and edge inset: topbar.css forces th/td padding and
                // font size with !important on 1024–1600px screens.
                'h-9 px-4 text-left align-middle first:*:ml-2 last:*:mr-2',
                column.className
              )}
            >
              <span
                className={cn(
                  'inline-block whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                  column.srOnly && 'sr-only'
                )}
              >
                {column.label}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup" className="block md:table-row-group">
        {children}
      </tbody>
    </table>
  );
}

export function ResponsiveRow({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <tr
      role="row"
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-2.5 border-b border-border px-4 py-4 last:border-0 md:table-row md:px-0 md:py-0',
        'transition-colors md:hover:bg-muted/40',
        muted && 'bg-muted/20'
      )}
    >
      {children}
    </tr>
  );
}

/**
 * `primary` cells span the full card width on mobile (title rows and actions); others show their
 * column label above the value.
 */
export function ResponsiveCell({
  label,
  children,
  primary,
  align,
  className,
}: {
  label: string;
  children: ReactNode;
  primary?: boolean;
  align?: 'end';
  className?: string;
}) {
  return (
    <td
      role="cell"
      data-label={label}
      className={cn(
        'min-w-0 align-middle md:border-b-0 md:px-4 md:py-3 md:first:*:ml-2 md:last:*:mr-2',
        primary
          ? 'col-span-2'
          : 'before:mb-0.5 before:block before:text-[10px] before:font-semibold before:uppercase before:tracking-wider before:text-muted-foreground before:content-[attr(data-label)] md:before:hidden',
        align === 'end' && 'md:text-right',
        className
      )}
    >
      {children}
    </td>
  );
}

export function ListEmpty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const TONE_CLASSES = {
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
  danger:
    'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300',
  violet:
    'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300',
  neutral: 'border-border bg-muted/60 text-muted-foreground',
} as const;
export type PillTone = keyof typeof TONE_CLASSES;
const TONES = new Map(Object.entries(TONE_CLASSES) as [PillTone, string][]);

/** Small status label, following the product's status colour semantics. */
export function StatusPill({
  tone,
  children,
  dot,
}: {
  tone: PillTone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-4',
        TONES.get(tone)
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
