'use client';

import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  CircleHelp,
  Columns3,
  LayoutGrid,
  List,
  Rows3,
  Rows4,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';

/**
 * Shared list-page directory: one header row, a dense table (default) or a
 * card grid, and the viewer's choice remembered per page. Users, Teams,
 * Services, Schedules, Policies, Postmortems and Action Items all use it, so
 * a change here changes every directory.
 */

export type DirectoryView = 'table' | 'cards';
export type DirectoryDensity = 'comfortable' | 'compact';
export type DirectorySort = { key: string; direction: 'asc' | 'desc' };

const VIEW_EVENT = 'opsknight:directory-view';
// Used when localStorage is blocked, so the toggles still work for this visit.
const memoryStore = new Map<string, string>();
// When the view toggle was last used, so only a view switch (not a page load) animates.
let lastViewSwitchAt = -Infinity;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memoryStore.get(key) ?? null;
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function writeStored(key: string, value: string) {
  memoryStore.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the in-memory value above still applies.
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
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
    () => {
      const stored = readStored(key);
      return stored === 'table' || stored === 'cards' ? stored : fallback;
    },
    () => fallback
  );

  const update = (next: DirectoryView) => {
    lastViewSwitchAt = performance.now();
    writeStored(key, next);
  };

  return [view, update] as const;
}

const DENSITY_KEY = 'opsknight:directory-density';

/** Row density, one choice per user shared by every directory. */
export function useDirectoryDensity() {
  const density = useSyncExternalStore<DirectoryDensity>(
    subscribeView,
    () => (readStored(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'),
    () => 'comfortable'
  );
  return [density, (next: DirectoryDensity) => writeStored(DENSITY_KEY, next)] as const;
}

type ColumnOption = { id: string; header: ReactNode; label?: string; hideable?: boolean };

export type DirectoryColumnVisibility = {
  items: readonly ColumnOption[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string, visible: boolean) => void;
};

/**
 * Hidden-column ids remembered per directory. Pass the result to
 * `DirectoryHeader columns` and its `hidden` set to `DirectoryTable hiddenColumns`.
 */
export function useDirectoryColumns(
  storageKey: string,
  items: readonly ColumnOption[]
): DirectoryColumnVisibility {
  const key = `opsknight:directory-columns:${storageKey}`;
  const stored = useSyncExternalStore(
    subscribeView,
    () => readStored(key) ?? '',
    () => ''
  );
  const hidden = useMemo(() => new Set(stored.split(',').filter(Boolean)), [stored]);
  const onToggle = (id: string, visible: boolean) => {
    const next = new Set(hidden);
    if (visible) next.delete(id);
    else next.add(id);
    writeStored(key, [...next].join(','));
  };
  return { items, hidden, onToggle };
}

/** Fades in a table or card grid that mounted because the view toggle was just used. */
function useViewSwitchEnter() {
  const [enter] = useState(
    () => typeof window !== 'undefined' && performance.now() - lastViewSwitchAt < 1000
  );
  return enter ? 'animate-in fade-in-0 duration-150 motion-reduce:animate-none' : undefined;
}

const motion = 'transition-colors duration-150 motion-reduce:transition-none';

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
  return (
    <SegmentedToggle
      label="Directory view"
      value={value}
      onChange={onChange}
      options={[
        ['table', 'Table view', <List key="table" className="h-3.5 w-3.5" aria-hidden="true" />],
        [
          'cards',
          cardsLabel,
          cardsIcon ?? <LayoutGrid key="cards" className="h-3.5 w-3.5" aria-hidden="true" />,
        ],
      ]}
    />
  );
}

/** Comfortable (~52px) or compact (~40px) rows; the choice applies to every directory. */
export function DirectoryDensityToggle() {
  const [density, setDensity] = useDirectoryDensity();
  return (
    <SegmentedToggle
      label="Row density"
      value={density}
      onChange={setDensity}
      options={[
        [
          'comfortable',
          'Comfortable rows',
          <Rows3 key="comfortable" className="h-3.5 w-3.5" aria-hidden="true" />,
        ],
        [
          'compact',
          'Compact rows',
          <Rows4 key="compact" className="h-3.5 w-3.5" aria-hidden="true" />,
        ],
      ]}
    />
  );
}

function SegmentedToggle<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: readonly (readonly [V, string, ReactNode])[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center rounded-md border border-border bg-muted/60 p-0.5"
    >
      {options.map(([option, optionLabel, icon]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          aria-label={optionLabel}
          title={optionLabel}
          onClick={() => onChange(option)}
          className={cn(
            'inline-flex h-7 w-8 items-center justify-center rounded-[5px]',
            motion,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === option
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/** "Columns" menu: show or hide the directory's `hideable` columns (never the first). */
export function DirectoryColumnsMenu({ items, hidden, onToggle }: DirectoryColumnVisibility) {
  const hideable = items.filter((column, index) => index > 0 && column.hideable);
  if (hideable.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs font-medium">
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Columns
          {hidden.size > 0 && (
            <span className="tabular-nums text-muted-foreground">
              {hideable.length - hideable.filter(c => hidden.has(c.id)).length}/{hideable.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map(column => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden.has(column.id)}
            onCheckedChange={checked => onToggle(column.id, checked === true)}
            // Keep the menu open so several columns can be toggled in one go.
            onSelect={event => event.preventDefault()}
          >
            {column.label ?? (typeof column.header === 'string' ? column.header : column.id)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  density,
  columns,
  guide,
  actions,
  className,
}: {
  /** Show the comfortable/compact row toggle (shared across directories). */
  density?: boolean;
  /** Show the "Columns" menu; pass the result of `useDirectoryColumns`. */
  columns?: DirectoryColumnVisibility;
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
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground motion-safe:transition-colors motion-safe:duration-150">
            <Checkbox
              checked={selectAll.indeterminate ? 'indeterminate' : selectAll.checked}
              onCheckedChange={state => selectAll.onCheckedChange(state === true)}
              aria-label={selectAll.label ?? 'Select all'}
            />
            <span aria-hidden="true">{selectAll.label ?? 'Select all'}</span>
          </label>
        )}
        {sort}
        {columns && <DirectoryColumnsMenu {...columns} />}
        {density && <DirectoryDensityToggle />}
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
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-bold text-primary"
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
  /** Text for the "Columns" menu when `header` isn't a plain string. */
  label?: string;
  /** Listed in the "Columns" menu so viewers can hide it. Ignored on the first (primary) column. */
  hideable?: boolean;
  /** Makes the header a sort button. Server-sorted tables map it to their URL param via `onSortChange`. */
  sortKey?: string;
  /** Client-side sort value; only used when the table has no `onSortChange`. */
  sortValue?: (row: T) => string | number | null | undefined;
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
  /** Column ids to leave out (from `useDirectoryColumns().hidden`). */
  hiddenColumns?: ReadonlySet<string>;
  /** Server-side sort: the current sort and a handler that updates the URL. Omit both to sort `rows` client-side. */
  sort?: DirectorySort | null;
  onSortChange?: (sort: DirectorySort) => void;
};

const TYPING_TARGET = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Dense directory table: sticky header, divided rows, hover and focus states; stacked rows on phones.
 * Keyboard: j/k or ↓/↑ move between rows, Enter opens the row's first link, x toggles its checkbox.
 */
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
  hiddenColumns,
  sort: controlledSort,
  onSortChange,
}: DirectoryTableProps<T>) {
  const [density] = useDirectoryDensity();
  const enter = useViewSwitchEnter();
  const [localSort, setLocalSort] = useState<DirectorySort | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sort = onSortChange ? (controlledSort ?? null) : localSort;
  const visibleColumns = columns.filter(
    (column, index) => index === 0 || !column.hideable || !hiddenColumns?.has(column.id)
  );
  const sortColumn = onSortChange ? undefined : columns.find(c => c.sortKey === sort?.key);
  const sortedRows = useMemo(() => {
    const value = sortColumn?.sortValue;
    if (!value || !sort) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      // Empty values always sink to the bottom.
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;
      if (y == null || y === '') return -1;
      return (
        factor *
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true }))
      );
    });
  }, [rows, sort, sortColumn]);

  if (rows.length === 0 && empty) return <>{empty}</>;

  const toggleSort = (key: string) => {
    const next: DirectorySort = {
      key,
      direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
    };
    if (onSortChange) onSortChange(next);
    else setLocalSort(next);
  };

  const rowById = new Map(sortedRows.map(row => [getRowId(row), row]));
  const focusId =
    activeId && rowById.has(activeId)
      ? activeId
      : sortedRows.length > 0
        ? getRowId(sortedRows[0])
        : null;

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const target = event.target as HTMLElement;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      // Portalled menus bubble through React; only handle keys from the table itself.
      !event.currentTarget.contains(target) ||
      target.closest(TYPING_TARGET)
    ) {
      return;
    }
    const tr = target.closest<HTMLElement>('tr[data-row-id]');
    if (!tr) return;
    const key = event.key;
    if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
      const next =
        key === 'j' || key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      event.preventDefault();
      if (next instanceof HTMLElement) next.focus();
    } else if (key === 'Enter' && target === tr) {
      const link = tr.querySelector<HTMLAnchorElement>('a[href]');
      if (link) {
        event.preventDefault();
        link.click();
      }
    } else if (key === 'x' && selection) {
      const id = tr.dataset.rowId!;
      const row = rowById.get(id);
      if (row && selection.isSelectable?.(row) !== false) {
        event.preventDefault();
        selection.onToggle(id, !selection.selected.has(id));
      }
    }
  };

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

  const compact = density === 'compact';
  const cellY = compact ? 'py-1' : 'py-2.5';

  return (
    <div className={cn(enter, className)} data-density={density}>
      <ul aria-label={label} className="divide-y divide-border text-sm sm:hidden">
        {sortedRows.map(row => (
          <li
            key={getRowId(row)}
            className={cn('flex items-center gap-3 px-4', compact ? 'py-2' : 'py-3')}
          >
            {checkbox(row)}
            <div className="min-w-0 flex-1">{mobileRow(row)}</div>
            {rowActions?.(row)}
          </li>
        ))}
      </ul>

      <table aria-label={label} className="hidden w-full caption-bottom text-sm sm:table">
        <thead className="sticky top-0 z-10 bg-card">
          {/* The header line is drawn per cell: a collapsed-table row border doesn't stick with the header. */}
          <tr className="[&>th]:relative [&>th]:after:absolute [&>th]:after:inset-x-0 [&>th]:after:bottom-0 [&>th]:after:h-px [&>th]:after:bg-border">
            {selection && <th scope="col" className="w-10 px-4 py-2" />}
            {visibleColumns.map(column => {
              const direction = sort?.key === column.sortKey ? sort?.direction : undefined;
              const sortable =
                column.sortKey !== undefined && (onSortChange !== undefined || !!column.sortValue);
              const Arrow =
                direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    direction === 'asc'
                      ? 'ascending'
                      : direction === 'desc'
                        ? 'descending'
                        : undefined
                  }
                  className={cn(
                    'px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground',
                    column.className
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.sortKey!)}
                      className={cn(
                        '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase tracking-wider hover:text-foreground',
                        motion,
                        direction && 'text-foreground',
                        focusRing
                      )}
                    >
                      {column.header}
                      <Arrow
                        className={cn('h-3 w-3 shrink-0', !direction && 'opacity-50')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
            {rowActions && (
              <th scope="col" className="w-12 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border" onKeyDown={onKeyDown}>
          {sortedRows.map(row => {
            const id = getRowId(row);
            return (
              <tr
                key={id}
                data-row-id={id}
                data-state={selection?.selected.has(id) ? 'selected' : undefined}
                // Roving tab stop: one row is tabbable, the rest are reached with j/k.
                tabIndex={id === focusId ? 0 : -1}
                onFocus={() => setActiveId(id)}
                className={cn(
                  motion,
                  compact ? 'h-10' : 'h-[3.25rem]',
                  'hover:bg-muted/50 focus-within:bg-muted/40 data-[state=selected]:bg-primary/5',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                )}
              >
                {selection && (
                  <td className={cn('w-10 px-4 align-middle', cellY)}>{checkbox(row)}</td>
                )}
                {visibleColumns.map(column => (
                  <td key={column.id} className={cn('px-3 align-middle', cellY, column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className={cn('w-12 px-3 text-right', cellY)}>{rowActions(row)}</td>
                )}
              </tr>
            );
          })}
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
  const enter = useViewSwitchEnter();
  return (
    <div
      className={cn('grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3', enter, className)}
    >
      {children}
    </div>
  );
}
