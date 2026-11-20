'use client';

import Link from 'next/link';
import { useSyncExternalStore, type ReactNode } from 'react';
import { ArrowUpRight, CircleHelp, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';

/**
 * Shared list-page directory: one header row, a dense table (default) or a
 * card grid, and the viewer's choice remembered per page. Users, Teams,
 * Services, Schedules, Policies, Postmortems and Action Items all use it, so
 * a change here changes every directory.
 */

export type DirectoryView = 'table' | 'cards';

const VIEW_EVENT = 'opsknight:directory-view';
// Used when localStorage is blocked, so the toggle still works for this visit.
const memoryViews = new Map<string, DirectoryView>();

function readView(key: string): DirectoryView | null {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === 'table' || stored === 'cards' ? stored : (memoryViews.get(key) ?? null);
  } catch {
    return memoryViews.get(key) ?? null;
  }
}

function subscribeView(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(VIEW_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(VIEW_EVENT, onChange);
  };
}

/** View choice persisted in localStorage; the server and first paint use `fallback`. */
export function useDirectoryView(storageKey: string, fallback: DirectoryView = 'table') {
  const key = `opsknight:directory-view:${storageKey}`;
  const view = useSyncExternalStore(
    subscribeView,
    () => readView(key) ?? fallback,
    () => fallback
  );

  const update = (next: DirectoryView) => {
    memoryViews.set(key, next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Storage blocked: the in-memory value above still applies.
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  };

  return [view, update] as const;
}

export function DirectoryViewToggle({
  value,
  onChange,
  cardsLabel = 'Card view',
  cardsIcon,
}: {
  value: DirectoryView;
  onChange: (view: DirectoryView) => void;
  /** Rename the alternative view, e.g. "Board view" on Action Items. */
  cardsLabel?: string;
  cardsIcon?: ReactNode;
}) {
  const option = (view: DirectoryView, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={value === view}
      aria-label={label}
      title={label}
      onClick={() => onChange(view)}
      className={cn(
        'inline-flex h-7 w-8 items-center justify-center rounded-[5px] transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        value === view
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Directory view"
      className="inline-flex items-center rounded-md border border-border bg-muted/60 p-0.5"
    >
      {option('table', 'Table view', <List className="h-3.5 w-3.5" aria-hidden="true" />)}
      {option(
        'cards',
        cardsLabel,
        cardsIcon ?? <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </div>
  );
}

export type DirectorySelectAll = {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
};

/** Title + summary on the left; select-all, sort, view toggle and actions on the right. */
export function DirectoryHeader({
  title,
  summary,
  selectAll,
  sort,
  view,
  guide,
  actions,
  className,
}: {
  title: ReactNode;
  summary?: ReactNode;
  /** A `DirectoryGuide`; rendered first on the right, before the controls. */
  guide?: ReactNode;
  selectAll?: DirectorySelectAll;
  sort?: ReactNode;
  view?: {
    value: DirectoryView;
    onChange: (view: DirectoryView) => void;
    cardsLabel?: string;
    cardsIcon?: ReactNode;
  };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {summary && <p className="text-xs text-muted-foreground tabular-nums">{summary}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {guide}
        {selectAll && (
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <Checkbox
              checked={selectAll.indeterminate ? 'indeterminate' : selectAll.checked}
              onCheckedChange={state => selectAll.onCheckedChange(state === true)}
              aria-label={selectAll.label ?? 'Select all'}
            />
            <span aria-hidden="true">{selectAll.label ?? 'Select all'}</span>
          </label>
        )}
        {sort}
        {view && <DirectoryViewToggle {...view} />}
        {actions}
      </div>
    </div>
  );
}

export type DirectoryGuideStep = { title: string; description: string };
export type DirectoryGuideLink = { label: string; href: string; icon?: ReactNode };

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Numbered how-it-works steps, with optional links underneath. Shared by the header popover and empty states. */
export function DirectoryGuideSteps({
  steps,
  links,
  className,
}: {
  steps: readonly DirectoryGuideStep[];
  links?: readonly DirectoryGuideLink[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-3 text-left', className)}>
      <ol className="space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-2.5 text-xs">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary"
            >
              {index + 1}
            </span>
            <span>
              <span className="block font-semibold text-foreground">{step.title}</span>
              <span className="mt-0.5 block leading-snug text-muted-foreground">
                {step.description}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {links && links.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline',
                focusRing
              )}
            >
              {link.label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Directory-header help: quick links inline (from `sm` up) and a "How … works"
 * popover with numbered steps and the same links, so phones still reach them.
 */
export function DirectoryGuide({
  title,
  steps,
  links = [],
}: {
  /** Button label and accessible name, e.g. "How schedules work". */
  title: string;
  steps: readonly DirectoryGuideStep[];
  links?: readonly DirectoryGuideLink[];
}) {
  return (
    <div className="flex items-center gap-1">
      {links.map(link => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            'hidden h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex',
            focusRing
          )}
        >
          {link.icon}
          {link.label}
        </Link>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
            {title}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={title} className="w-80 p-4">
          <DirectoryGuideSteps steps={steps} links={links} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export type DirectoryColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Applied to both the header and body cells (width, alignment, responsive hiding). */
  className?: string;
};

export type DirectoryTableProps<T> = {
  rows: readonly T[];
  getRowId: (row: T) => string;
  columns: readonly DirectoryColumn<T>[];
  /** Accessible name for the table, e.g. "Users". */
  label: string;
  /** Row checkbox selection (bulk actions). */
  selection?: {
    selected: ReadonlySet<string>;
    onToggle: (id: string, checked: boolean) => void;
    rowLabel: (row: T) => string;
    /** Rows that can't be selected (e.g. your own account) get no checkbox. */
    isSelectable?: (row: T) => boolean;
  };
  /** Right-aligned per-row actions (usually a kebab menu). */
  rowActions?: (row: T) => ReactNode;
  /** Phone layout (<640px): one stacked row per item instead of columns. */
  mobileRow: (row: T) => ReactNode;
  empty?: ReactNode;
  className?: string;
};

/** Dense directory table: sticky header, divided rows, hover and focus states; stacked rows on phones. */
export function DirectoryTable<T>({
  rows,
  getRowId,
  columns,
  label,
  selection,
  rowActions,
  mobileRow,
  empty,
  className,
}: DirectoryTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const checkbox = (row: T) => {
    if (!selection || selection.isSelectable?.(row) === false) return null;
    const id = getRowId(row);
    return (
      <Checkbox
        checked={selection.selected.has(id)}
        onCheckedChange={state => selection.onToggle(id, state === true)}
        aria-label={selection.rowLabel(row)}
      />
    );
  };

  return (
    <div className={className}>
      <ul aria-label={label} className="divide-y divide-border text-sm sm:hidden">
        {rows.map(row => (
          <li key={getRowId(row)} className="flex items-center gap-3 px-4 py-3">
            {checkbox(row)}
            <div className="min-w-0 flex-1">{mobileRow(row)}</div>
            {rowActions?.(row)}
          </li>
        ))}
      </ul>

      <table aria-label={label} className="hidden w-full caption-bottom text-sm sm:table">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {selection && <th scope="col" className="w-10 px-4 py-2" />}
            {columns.map(column => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  'px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground',
                  column.className
                )}
              >
                {column.header}
              </th>
            ))}
            {rowActions && (
              <th scope="col" className="w-12 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr
              key={getRowId(row)}
              className="transition-colors duration-150 hover:bg-muted/50 focus-within:bg-muted/40"
            >
              {selection && <td className="w-10 px-4 py-2.5 align-middle">{checkbox(row)}</td>}
              {columns.map(column => (
                <td key={column.id} className={cn('px-3 py-2.5 align-middle', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
              {rowActions && <td className="w-12 px-3 py-2.5 text-right">{rowActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Primary cell: optional leading visual, a title link and a muted secondary line. */
export function DirectoryPrimaryCell({
  href,
  title,
  subtitle,
  leading,
  titleAddon,
}: {
  href?: string;
  title: ReactNode;
  /** Shown after the title, outside the link (e.g. a "You" badge). */
  titleAddon?: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {leading && <span className="shrink-0">{leading}</span>}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {href ? (
            <Link
              href={href}
              className="truncate font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">{title}</span>
          )}
          {titleAddon}
        </div>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

/** Card-view grid used by every directory. */
export function DirectoryCardGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3', className)}>
      {children}
    </div>
  );
}
