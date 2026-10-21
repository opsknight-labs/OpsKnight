'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Archive,
  CheckCircle2,
  Filter,
  Hash,
  PencilLine,
  RotateCcw,
  Search,
  Server,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { SearchableRunbookSelect } from '../SearchableRunbookSelect';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { cn } from '@/lib/utils';

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
    Boolean(searchTerm.trim()),
    status !== 'all',
    serviceId !== 'all',
    teamId !== 'all',
    Boolean(activeTag),
    Boolean(ownerId),
  ].filter(Boolean).length;

  const hasActiveFilters = activeFiltersCount > 0;

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
    <Card className="border border-border/80 shadow-xs transition-colors">
      <CardHeader className="py-2.5 sm:py-3 px-3.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold">
              <Filter className="h-3.5 w-3.5 text-primary" /> Filter Runbooks
            </CardTitle>
            <span className="hidden sm:inline text-muted-foreground/50 text-xs">•</span>
            <CardDescription className="text-[11px] text-muted-foreground mt-0">
              Filter by lifecycle, service bindings, owning team, or tags
            </CardDescription>
          </div>
          {hasActiveFilters && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
                onClick={resetFilters}
              >
                <X className="mr-1 h-3 w-3" /> Clear All
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 pt-0 px-3.5 sm:px-4 pb-3 sm:pb-3.5">
        {/* Quick Status Filters matching Services and Incidents */}
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            role="button"
            aria-pressed={status === 'all'}
            className={cn(
              'inline-flex items-center justify-center gap-1 border tracking-wide focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer transition-colors shadow-2xs font-medium py-0.5 px-2.5 text-xs rounded-lg',
              status === 'all'
                ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
            onClick={() => navigate({ status: 'all' })}
          >
            All active
          </button>
          <button
            type="button"
            role="button"
            aria-pressed={status === 'published'}
            className={cn(
              'inline-flex items-center justify-center gap-1 border tracking-wide focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer transition-colors shadow-2xs font-medium py-0.5 px-2.5 text-xs rounded-lg',
              status === 'published'
                ? 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700'
                : 'bg-card border-border/80 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-500/30'
            )}
            onClick={() => navigate({ status: status === 'published' ? 'all' : 'published' })}
          >
            <CheckCircle2 className="mr-1 h-3 w-3" /> Published
          </button>
          <button
            type="button"
            role="button"
            aria-pressed={status === 'draft'}
            className={cn(
              'inline-flex items-center justify-center gap-1 border tracking-wide focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer transition-colors shadow-2xs font-medium py-0.5 px-2.5 text-xs rounded-lg',
              status === 'draft'
                ? 'bg-amber-600 text-white border-amber-600 dark:bg-amber-500 hover:bg-amber-700'
                : 'bg-card border-border/80 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 hover:border-amber-500/30'
            )}
            onClick={() => navigate({ status: status === 'draft' ? 'all' : 'draft' })}
          >
            <PencilLine className="mr-1 h-3 w-3" /> Draft
          </button>
          <button
            type="button"
            role="button"
            aria-pressed={status === 'archived'}
            className={cn(
              'inline-flex items-center justify-center gap-1 border tracking-wide focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer transition-colors shadow-2xs font-medium py-0.5 px-2.5 text-xs rounded-lg',
              status === 'archived'
                ? 'bg-slate-700 text-white border-slate-700 hover:bg-slate-800'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
            onClick={() => navigate({ status: status === 'archived' ? 'all' : 'archived' })}
          >
            <Archive className="mr-1 h-3 w-3" /> Archived
          </button>
        </div>

        {/* Inputs Grid: Search, Service, Team, Apply */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-2.5 sm:gap-3 items-end">
          {/* Search */}
          <div className="space-y-1 md:col-span-2 lg:col-span-4">
            <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Search className="h-3 w-3" /> Search
            </Label>
            <div className="relative">
              <Input
                aria-label="Search runbooks"
                placeholder="Search by name, slug or purpose…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-8.5 rounded-lg pr-8 text-xs font-medium"
              />
              {searchTerm && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearchTerm('');
                    navigate({ q: '' }, 'replace');
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Service Filter */}
          <div className="space-y-1 md:col-span-1 lg:col-span-3">
            <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Server className="h-3 w-3" /> Service
            </Label>
            <SearchableRunbookSelect
              kind="service"
              label=""
              ariaLabel="Filter by service"
              placeholder="All services"
              value={serviceId}
              triggerClassName="h-8.5 rounded-lg"
              onChange={val => navigate({ service: val })}
            />
          </div>

          {/* Team Filter */}
          <div className="space-y-1 md:col-span-1 lg:col-span-3">
            <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> Team
            </Label>
            <Select value={teamId} onValueChange={val => navigate({ team: val })}>
              <SelectTrigger
                aria-label="Filter by team"
                className="h-8.5 w-full rounded-lg border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus:ring-2 focus:ring-primary/40 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <SelectValue placeholder="All teams" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl p-1.5">
                <SelectItem
                  value="all"
                  className="rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
                >
                  All teams
                </SelectItem>
                {teams.map(team => (
                  <SelectItem
                    key={team.id}
                    value={team.id}
                    className="rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
                  >
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Apply Filters */}
          <div className="md:col-span-2 lg:col-span-2">
            <Button
              size="sm"
              variant="outline"
              aria-label="Apply filters"
              onClick={() => navigate({})}
              className="h-8.5 w-full gap-1.5 rounded-lg text-xs font-medium shadow-2xs cursor-pointer border-border/80 bg-background/80 hover:bg-accent/40"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Apply filters</span>
            </Button>
          </div>
        </div>

        {/* Tags & Active Filters Metadata Row */}
        {(activeTag || ownerId || visibleTags.length > 0 || activeFiltersCount > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
            <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Hash className="h-3 w-3" aria-hidden="true" />
              Tags:
            </span>
            {activeTag && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 py-0.5 pl-2 pr-1 font-mono text-[10.5px] text-primary ring-1 ring-inset ring-primary/30 font-semibold">
                #{activeTag}
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
                className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-background hover:text-foreground hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              >
                #{item.tag}
                <span className="text-[9.5px] tabular-nums text-muted-foreground/70">
                  {item.count}
                </span>
              </button>
            ))}
            {!activeTag && visibleTags.length === 0 && (
              <span className="text-[11px] text-muted-foreground">No tags yet</span>
            )}
            {ownerId && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 py-0.5 pl-2 pr-0.5 text-[10.5px] text-foreground ring-1 ring-inset ring-border">
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
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {activeFiltersCount} {activeFiltersCount === 1 ? 'filter' : 'filters'} active
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  <span>Reset</span>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
