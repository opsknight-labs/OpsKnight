'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Search, X, RotateCcw } from 'lucide-react';

export type SearchFilterBarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
  /** Debounce server-backed searches to avoid a database request for every keystroke. */
  searchDebounceMs?: number;
  className?: string;
};

export default function SearchFilterBar({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters,
  actions,
  hasActiveFilters = false,
  onResetFilters,
  searchDebounceMs = 0,
  className,
}: SearchFilterBarProps) {
  const [draftSearch, setDraftSearch] = useState(searchValue);
  const skipNextDebounce = useRef(false);

  useEffect(() => {
    setDraftSearch(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (!onSearchChange || searchDebounceMs <= 0 || draftSearch === searchValue) return;
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }

    const timer = window.setTimeout(() => onSearchChange(draftSearch), searchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [draftSearch, onSearchChange, searchDebounceMs, searchValue]);

  const handleSearchChange = (value: string) => {
    setDraftSearch(value);
    if (searchDebounceMs <= 0) onSearchChange?.(value);
  };

  const clearSearch = () => {
    setDraftSearch('');
    skipNextDebounce.current = true;
    onSearchChange?.('');
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm md:flex-row md:items-center md:justify-between',
        className
      )}
    >
      {/* Left: Search input & filter slots */}
      <div className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={draftSearch}
              onChange={e => handleSearchChange(e.target.value)}
              className="h-9 pl-9 pr-8 text-xs sm:text-sm bg-slate-50/60 focus:bg-white transition-colors"
            />
            {draftSearch && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Filter dropdown slots */}
        {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}

        {/* Reset button */}
        {hasActiveFilters && onResetFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            className="h-9 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </Button>
        )}
      </div>

      {/* Right: Actions slot (e.g. Export CSV, Live badge, Create button) */}
      {actions && (
        <div className="flex shrink-0 items-center gap-2 justify-end pt-2 border-t border-slate-100 md:pt-0 md:border-t-0">
          {actions}
        </div>
      )}
    </div>
  );
}
