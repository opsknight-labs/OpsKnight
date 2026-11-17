'use client';

import type { ReactNode } from 'react';
import FilterBar from '@/components/patterns/FilterBar';

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

/** Single-row filter card; delegates to the shared `FilterBar` (`@/components/patterns`). */
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
  return (
    <FilterBar
      search={
        onSearchChange
          ? {
              value: searchValue,
              onChange: onSearchChange,
              placeholder: searchPlaceholder,
              debounceMs: searchDebounceMs,
            }
          : undefined
      }
      filters={filters}
      actions={actions}
      hasActiveFilters={hasActiveFilters}
      onClearAll={onResetFilters}
      clearLabel="Reset"
      className={className}
    />
  );
}
