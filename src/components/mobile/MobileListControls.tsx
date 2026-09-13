'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileSearch, { MobileFilterChip } from '@/components/mobile/MobileSearch';

type MobileListControlsProps = {
  basePath: string;
  filters: { label: string; value: string | null }[];
  sortOptions: { label: string; value: string }[];
  placeholder?: string;
};

export default function MobileListControls({
  basePath,
  filters,
  sortOptions,
  placeholder = 'Search...',
}: MobileListControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get('q') || '';
  const activeFilter = searchParams.get('filter') || 'all';
  const activeSort = searchParams.get('sort') || sortOptions[0]?.value || 'created_desc';
  const [term, setTerm] = useState(currentQuery);

  useEffect(() => {
    setTerm(currentQuery);
  }, [currentQuery]);

  const updateParams = useCallback(
    (updates: { q?: string; filter?: string | null; sort?: string }) => {
      const params = new URLSearchParams(searchParams);

      if (updates.q !== undefined) {
        if (updates.q) params.set('q', updates.q);
        else params.delete('q');
      }

      if (updates.filter !== undefined) {
        if (updates.filter && updates.filter !== 'all') params.set('filter', updates.filter);
        else params.delete('filter');
      }

      if (updates.sort !== undefined) {
        if (updates.sort) params.set('sort', updates.sort);
        else params.delete('sort');
      }

      const query = params.toString();
      router.replace(query ? `${basePath}?${query}` : basePath);
    },
    [basePath, router, searchParams]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (term !== currentQuery) updateParams({ q: term });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [term, currentQuery, updateParams]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <MobileSearch placeholder={placeholder} value={term} onChange={setTerm} />

      <div className="flex min-w-0 flex-col gap-2">
        <div
          className="flex min-w-0 gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Filters"
        >
          {filters.map(filter => (
            <MobileFilterChip
              key={filter.label}
              label={filter.label}
              active={activeFilter === (filter.value || 'all')}
              onClick={() => updateParams({ filter: filter.value })}
            />
          ))}
        </div>

        <div className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 shadow-sm">
          <label
            className="shrink-0 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground"
            htmlFor="mobile-sort"
          >
            Sort
          </label>
          <select
            id="mobile-sort"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-foreground outline-none focus-visible:ring-0"
            value={activeSort}
            onChange={event => updateParams({ sort: event.target.value })}
          >
            {sortOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
