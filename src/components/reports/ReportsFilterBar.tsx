'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterBar, FilterChip } from '@/components/patterns';

export type ReportsScope = 'all' | 'mine' | 'shared' | 'templates';

const SCOPES: Array<{ value: ReportsScope; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My dashboards' },
  { value: 'shared', label: 'Shared with me' },
  { value: 'templates', label: 'Templates' },
];

/** Search and scope filters for the Reports index; state lives in the URL (`q`, `scope`). */
export default function ReportsFilterBar({
  query,
  scope,
  counts,
}: {
  query: string;
  scope: ReportsScope;
  counts: Record<ReportsScope, number>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const update = (next: { q?: string; scope?: ReportsScope }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q.trim()) params.set('q', next.q.trim());
      else params.delete('q');
    }
    if (next.scope !== undefined) {
      if (next.scope !== 'all') params.set('scope', next.scope);
      else params.delete('scope');
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/reports?${qs}` : '/reports'));
  };

  return (
    <FilterBar
      search={{
        value: query,
        onChange: q => update({ q }),
        placeholder: 'Search dashboards and templates…',
        label: 'Search dashboards',
        debounceMs: 300,
      }}
      chips={SCOPES.map(option => (
        <FilterChip
          key={option.value}
          active={scope === option.value}
          count={counts[option.value]}
          onClick={() => update({ scope: option.value })}
        >
          {option.label}
        </FilterChip>
      ))}
      hasActiveFilters={Boolean(query) || scope !== 'all'}
      onClearAll={() => update({ q: '', scope: 'all' })}
    />
  );
}
