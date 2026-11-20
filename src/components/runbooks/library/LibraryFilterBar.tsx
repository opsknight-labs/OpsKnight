'use client';

import React, { useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Archive, CheckCircle2, PencilLine, UserRound } from 'lucide-react';
import { SearchableRunbookSelect } from '../SearchableRunbookSelect';
import { FilterBar, FilterChip, FilterField, type FilterChipTone } from '@/components/patterns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

export type LibraryTeamOption = { id: string; name: string };
export type LibraryTagOption = { tag: string; count: number };
export type LibraryStatusCounts = {
  all: number;
  published: number;
  draft: number;
  archived: number;
};

export type LibraryFilterBarProps = {
  query: Record<string, string>;
  teams?: LibraryTeamOption[];
  popularTags?: LibraryTagOption[];
  /** Lifecycle chip counts; chips render without counts when omitted. */
  counts?: LibraryStatusCounts;
};

const STATUS_OPTIONS: ReadonlyArray<{
  value: keyof LibraryStatusCounts;
  label: string;
  tone?: FilterChipTone;
  icon?: React.ReactNode;
}> = [
  { value: 'all', label: 'All active' },
  { value: 'published', label: 'Published', tone: 'ok', icon: <CheckCircle2 /> },
  { value: 'draft', label: 'Draft', tone: 'elevated', icon: <PencilLine /> },
  { value: 'archived', label: 'Archived', icon: <Archive /> },
];

const SEARCH_DEBOUNCE_MS = 300;

export function LibraryFilterBar({
  query,
  teams = [],
  popularTags = [],
  counts,
}: LibraryFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const status = STATUS_OPTIONS.some(option => option.value === query.status)
    ? query.status
    : query.tab === 'archived'
      ? 'archived'
      : 'all';
  const teamId = teams.some(team => team.id === query.team) ? query.team : 'all';
  const activeTag = query.tag ?? '';
  const serviceId = query.service ?? 'all';
  const ownerId = query.owner ?? '';

  const hasActiveFilters = Boolean(
    query.q?.trim() ||
    status !== 'all' ||
    serviceId !== 'all' ||
    teamId !== 'all' ||
    activeTag ||
    ownerId
  );

  const navigate = useCallback(
    (overrides: Record<string, string>, mode: 'push' | 'replace' = 'push') => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...query, ...overrides })) {
        const trimmed = value.trim();
        if (key === 'page' || !trimmed || trimmed === 'all') continue;
        params.set(key, trimmed);
      }
      if ('status' in overrides) params.delete('tab');
      const queryString = params.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      if (mode === 'replace') router.replace(href);
      else router.push(href);
    },
    [pathname, query, router]
  );

  const onSearch = useCallback((value: string) => navigate({ q: value }, 'replace'), [navigate]);

  // The active tag can come from a card link and fall outside the popular list.
  const tags =
    activeTag && !popularTags.some(item => item.tag === activeTag)
      ? [{ tag: activeTag, count: undefined }, ...popularTags]
      : popularTags;

  const chips = (
    <>
      {STATUS_OPTIONS.map(option => (
        <FilterChip
          key={option.value}
          tone={option.tone}
          icon={option.icon}
          active={status === option.value}
          count={counts?.[option.value]}
          onClick={() =>
            navigate({
              status: option.value !== 'all' && status === option.value ? 'all' : option.value,
            })
          }
        >
          {option.label}
        </FilterChip>
      ))}
      {ownerId && (
        <FilterChip icon={<UserRound />} onRemove={() => navigate({ owner: '' })}>
          Created by a specific user
        </FilterChip>
      )}
    </>
  );

  const filters = (
    <>
      <FilterField label="Service">
        <SearchableRunbookSelect
          kind="service"
          label=""
          ariaLabel="Filter by service"
          placeholder="All services"
          value={serviceId}
          className="sm:w-[200px]"
          triggerClassName="rounded-md text-sm"
          onChange={val => navigate({ service: val })}
        />
      </FilterField>
      <FilterField label="Team" htmlFor="runbook-filter-team">
        <Select value={teamId} onValueChange={val => navigate({ team: val })}>
          <SelectTrigger
            id="runbook-filter-team"
            aria-label="Filter by team"
            className="h-9 w-[160px] text-sm"
          >
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>
    </>
  );

  const advanced = (
    <div role="group" aria-label="Filter by tag" className="col-span-full flex flex-wrap gap-1.5">
      {tags.length === 0 ? (
        <span className="text-xs text-muted-foreground">No tags yet</span>
      ) : (
        tags.map(item => (
          <FilterChip
            key={item.tag}
            active={item.tag === activeTag}
            count={item.count}
            className="font-mono"
            onClick={() => navigate({ tag: item.tag === activeTag ? '' : item.tag })}
          >
            #{item.tag}
          </FilterChip>
        ))
      )}
    </div>
  );

  return (
    <FilterBar
      chips={chips}
      search={{
        value: query.q ?? '',
        onChange: onSearch,
        placeholder: 'Search by name, slug or purpose…',
        label: 'Search runbooks',
        debounceMs: SEARCH_DEBOUNCE_MS,
      }}
      filters={filters}
      advanced={advanced}
      advancedLabel="Tags"
      advancedActiveCount={activeTag ? 1 : 0}
      defaultAdvancedOpen={Boolean(activeTag)}
      hasActiveFilters={hasActiveFilters}
      onClearAll={() => router.push(pathname)}
    />
  );
}
