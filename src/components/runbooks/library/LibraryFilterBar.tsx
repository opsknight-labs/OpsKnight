'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Filter, Hash, RotateCcw, UserRound, Users, X } from 'lucide-react';
import { SearchableRunbookSelect } from '../SearchableRunbookSelect';
import { SearchField, Segmented } from '../ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

export type LibraryTeamOption = { id: string; name: string };
export type LibraryTagOption = { tag: string; count: number };

export type LibraryFilterBarProps = {
  query: Record<string, string>;
  teams?: LibraryTeamOption[];
  popularTags?: LibraryTagOption[];
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All active' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
] as const;

type StatusValue = (typeof STATUS_OPTIONS)[number]['value'];

const SEARCH_DEBOUNCE_MS = 300;
const MAX_TAG_CHIPS = 12;

export function LibraryFilterBar({ query, teams = [], popularTags = [] }: LibraryFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState(query.q ?? '');

  const status = STATUS_OPTIONS.some(option => option.value === query.status)
    ? query.status
    : query.tab === 'archived'
      ? 'archived'
      : 'all';
  const teamId = teams.some(team => team.id === query.team) ? query.team : 'all';
  const activeTag = query.tag ?? '';
  const serviceId = query.service ?? 'all';
  const ownerId = query.owner ?? '';

  const activeFiltersCount = [
    Boolean(query.q?.trim()),
    status !== 'all',
    serviceId !== 'all',
    teamId !== 'all',
    Boolean(activeTag),
    Boolean(ownerId),
  ].filter(Boolean).length;

  const navigate = useCallback(
    (overrides: Record<string, string>, mode: 'push' | 'replace' = 'push') => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...query, q: searchTerm, ...overrides })) {
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
    [pathname, query, router, searchTerm]
  );

  useEffect(() => {
    const next = searchTerm.trim();
    if (next === (query.q ?? '').trim()) return;
    const timer = setTimeout(() => navigate({ q: next }, 'replace'), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [navigate, query.q, searchTerm]);

  const resetFilters = () => {
    setSearchTerm('');
    router.push(pathname);
  };

  const visibleTags = popularTags.filter(item => item.tag !== activeTag).slice(0, MAX_TAG_CHIPS);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          onSubmit={e => {
            e.preventDefault();
            navigate({});
          }}
          className="flex h-9 min-w-0 basis-full items-center rounded-md border border-input bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring xl:min-w-[260px] xl:flex-1 xl:basis-auto"
        >
          <SearchField
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by name, slug or purpose…"
            aria-label="Search runbooks"
            className="h-full flex-1 border-0 bg-transparent shadow-none focus-within:ring-0"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchTerm('');
                navigate({ q: '' }, 'replace');
              }}
              className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </form>

        <Segmented
          label="Filter by status"
          value={status as StatusValue}
          onChange={value => navigate({ status: value })}
          options={STATUS_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
          className="max-w-full shrink-0 overflow-x-auto"
        />

        <div className="w-full min-w-0 sm:w-[200px]">
          <SearchableRunbookSelect
            kind="service"
            label=""
            ariaLabel="Filter by service"
            placeholder="All services"
            value={serviceId}
            onChange={val => navigate({ service: val })}
          />
        </div>

        <Select value={teamId} onValueChange={val => navigate({ team: val })}>
          <SelectTrigger
            className="h-9 w-full bg-background text-xs sm:w-[180px]"
            aria-label="Filter by team"
          >
            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              All teams
            </SelectItem>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id} className="text-xs">
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="secondary"
          aria-label="Apply filters"
          onClick={() => navigate({})}
          className="h-9 gap-1.5 text-xs max-sm:flex-1"
        >
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Apply filters</span>
        </Button>
      </div>

      {(activeTag || ownerId || visibleTags.length > 0 || activeFiltersCount > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Hash className="h-3 w-3" aria-hidden="true" />
            Tags
          </span>
          {activeTag && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-0.5 font-mono text-[11px] text-primary ring-1 ring-inset ring-primary/30">
              {activeTag}
              <button
                type="button"
                aria-label={`Remove tag filter ${activeTag}`}
                onClick={() => navigate({ tag: '' })}
                className="rounded-full p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}
          {visibleTags.map(item => (
            <button
              key={item.tag}
              type="button"
              aria-label={`Filter by tag ${item.tag}`}
              onClick={() => navigate({ tag: item.tag })}
              className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-background hover:text-foreground hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.tag}
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {item.count}
              </span>
            </button>
          ))}
          {!activeTag && visibleTags.length === 0 && (
            <span className="text-xs text-muted-foreground">No tags yet</span>
          )}
          {ownerId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 py-0.5 pl-2 pr-0.5 text-[11px] text-foreground ring-1 ring-inset ring-border">
              <UserRound className="h-3 w-3" aria-hidden="true" />
              Created by a specific user
              <button
                type="button"
                aria-label="Remove author filter"
                onClick={() => navigate({ owner: '' })}
                className="rounded-full p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}
          {activeFiltersCount > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {activeFiltersCount} {activeFiltersCount === 1 ? 'filter' : 'filters'} active
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reset</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
