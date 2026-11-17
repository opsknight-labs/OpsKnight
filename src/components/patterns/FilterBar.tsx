'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';

export type FilterBarSearch = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  /** Debounce server-backed searches so each keystroke does not hit the database. */
  debounceMs?: number;
};

export type FilterBarProps = {
  /** Title row; omit for a single compact row. */
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  search?: FilterBarSearch;
  /** Select/segment slots, usually `<FilterField>`s. */
  filters?: ReactNode;
  /** Quick-filter or active-filter chips (`<FilterChip>`). */
  chips?: ReactNode;
  /** Collapsible "Advanced filters" content. */
  advanced?: ReactNode;
  advancedLabel?: string;
  defaultAdvancedOpen?: boolean;
  /** Count of active advanced filters, shown on the toggle. */
  advancedActiveCount?: number;
  /** Shows "Clear all" when true and `onClearAll` is set. */
  hasActiveFilters?: boolean;
  onClearAll?: () => void;
  clearLabel?: string;
  /** Right-aligned slot (export, live indicator, create button). */
  actions?: ReactNode;
  className?: string;
};

function FilterSearchInput({ search }: { search: FilterBarSearch }) {
  const { value, onChange, placeholder = 'Search…', label, debounceMs = 0 } = search;
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const skipNextDebounce = useRef(false);

  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    if (debounceMs <= 0 || draft === value) return;
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const timer = window.setTimeout(() => onChange(draft), debounceMs);
    return () => window.clearTimeout(timer);
  }, [draft, onChange, debounceMs, value]);

  const update = (next: string) => {
    setDraft(next);
    if (debounceMs <= 0) onChange(next);
  };

  const clear = () => {
    setDraft('');
    skipNextDebounce.current = true;
    onChange('');
  };

  return (
    <div className="relative w-full min-w-[12rem] md:max-w-md md:flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={draft}
        onChange={e => update(e.target.value)}
        className="h-9 bg-background pl-9 pr-8 text-sm transition-colors duration-150 hover:border-ink-300 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * The list-page filter card: optional title row, search, filter slots, chips,
 * "Clear all" and a collapsible advanced section. Keep filter state in the URL.
 */
export default function FilterBar({
  title,
  description,
  icon,
  search,
  filters,
  chips,
  advanced,
  advancedLabel = 'Advanced filters',
  defaultAdvancedOpen = false,
  advancedActiveCount = 0,
  hasActiveFilters = false,
  onClearAll,
  clearLabel = 'Clear all',
  actions,
  className,
}: FilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);
  const showClear = hasActiveFilters && Boolean(onClearAll);
  const hasHeader = Boolean(title || description);

  const clearButton = showClear ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClearAll}
      className="h-9 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{clearLabel}</span>
    </Button>
  ) : null;

  return (
    <section
      aria-label={typeof title === 'string' ? title : 'Filters'}
      className={cn('rounded-lg border border-border bg-card shadow-sm', className)}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-1 pt-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 font-sans text-sm font-semibold text-foreground">
                {icon && (
                  <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden>
                    {icon}
                  </span>
                )}
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {clearButton}
            {actions}
          </div>
        </div>
      )}

      <div className={cn('space-y-3 p-3', hasHeader && 'px-4 pb-4 pt-2')}>
        {chips && (
          <div
            role="group"
            aria-label="Quick filters"
            className="flex flex-wrap items-center gap-1.5"
          >
            {chips}
          </div>
        )}

        {(search || filters || (!hasHeader && (clearButton || actions))) && (
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              {search && <FilterSearchInput search={search} />}
              {filters && <div className="flex flex-wrap items-end gap-2.5">{filters}</div>}
              {!hasHeader && clearButton}
            </div>
            {!hasHeader && actions && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border pt-3 md:border-t-0 md:pt-0">
                {actions}
              </div>
            )}
          </div>
        )}

        {advanced && (
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{advancedLabel}</span>
                {advancedActiveCount > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold tabular-nums text-primary-foreground">
                    {advancedActiveCount}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-200',
                    advancedOpen && 'rotate-180'
                  )}
                  aria-hidden="true"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
              {advanced}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </section>
  );
}

/** Labelled control slot for FilterBar (label above the select). */
export function FilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const fallbackId = useId();
  return (
    <div className={cn('flex min-w-[10rem] flex-col gap-1.5', className)}>
      <Label
        htmlFor={htmlFor}
        id={htmlFor ? undefined : fallbackId}
        className="text-xs text-muted-foreground"
      >
        {label}
      </Label>
      <div role={htmlFor ? undefined : 'group'} aria-labelledby={htmlFor ? undefined : fallbackId}>
        {children}
      </div>
    </div>
  );
}

/**
 * Filter chip. With `onClick` it is a toggle (`aria-pressed`); with `onRemove` it is an
 * active-filter token that removes itself.
 */
export function FilterChip({
  children,
  active = false,
  onClick,
  onRemove,
  count,
  icon,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  count?: number;
  icon?: ReactNode;
  className?: string;
}) {
  const removable = Boolean(onRemove);
  return (
    <button
      type="button"
      aria-pressed={removable ? undefined : active}
      aria-label={
        removable && typeof children === 'string' ? `Remove filter: ${children}` : undefined
      }
      onClick={removable ? onRemove : onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5',
        active || removable
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground active:bg-ink-200',
        className
      )}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span>{children}</span>
      {typeof count === 'number' && <span className="tabular-nums opacity-80">{count}</span>}
      {removable && <X aria-hidden="true" />}
    </button>
  );
}
