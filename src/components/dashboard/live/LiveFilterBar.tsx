'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Check,
  ChevronsUpDown,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import {
  LIVE_INCIDENT_VIEWS,
  liveViewLabel,
  type LiveFacetOption,
  type LiveIncidentQuery,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';

export type LiveDirectoryOption = { id: string; name: string };

const SEARCH_DEBOUNCE_MS = 250;
const controlClass =
  'h-8 rounded-lg border-border bg-card px-2.5 text-xs shadow-2xs hover:border-slate-300';

/** Facet options with live counts first, then the rest of the viewer's directory at zero. */
function mergeOptions(directory: LiveDirectoryOption[], facets: LiveFacetOption[]) {
  const seen = new Set(facets.map(option => option.id));
  return [
    ...facets,
    ...directory
      .filter(entry => !seen.has(entry.id))
      .map(entry => ({ ...entry, count: 0, critical: 0 })),
  ];
}

function FacetCombobox({
  label,
  icon,
  testId,
  value,
  options,
  onChange,
  className,
  compactLabel = false,
}: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  value: string | null;
  options: LiveFacetOption[];
  onChange: (id: string | null) => void;
  className?: string;
  compactLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Filter live incidents by ${label.toLowerCase()}`}
          data-testid={testId}
          className={cn(
            controlClass,
            'justify-between gap-1.5 font-normal',
            value && 'border-primary/50 bg-primary/5 font-medium text-primary',
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {icon}
            <span className="truncate">
              {selected?.name ?? (compactLabel ? label : `All ${label.toLowerCase()}s`)}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[21rem] overflow-hidden rounded-xl border border-border/80 p-0 shadow-xl dark:border-zinc-800 dark:shadow-2xl dark:shadow-black/60"
        align="start"
      >
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}s…`} />
          <CommandList className="max-h-[280px] p-1">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No {label.toLowerCase()}s found.
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`all ${label}`}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span className="flex-1">All {label.toLowerCase()}s</span>
                <span className="flex h-3.5 w-3.5 items-center justify-center">
                  {!value && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
                </span>
              </CommandItem>
              {options.map(option => (
                <CommandItem
                  key={option.id}
                  value={`${option.name} ${option.id}`}
                  data-testid={`${testId}-option`}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="group cursor-pointer px-2.5 py-1.5 text-xs"
                >
                  <span className="flex-1 truncate font-medium text-foreground">{option.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5 pl-2">
                    {option.critical > 0 && (
                      <span className="rounded border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-rose-600 dark:text-rose-400">
                        {option.critical} crit
                      </span>
                    )}
                    <span
                      className={cn(
                        'min-w-5 rounded px-1 text-center font-mono text-[10px] tabular-nums',
                        option.count > 0
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground/60'
                      )}
                    >
                      {option.count}
                    </span>
                    <span className="flex h-3.5 w-3.5 items-center justify-center">
                      {option.id === value && (
                        <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                      )}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  cols,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  testId: string;
  cols?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'grid gap-1 rounded-lg border border-border/60 bg-muted/30 p-1 dark:bg-zinc-900/40',
          cols ?? 'grid-cols-3'
        )}
        data-testid={testId}
      >
        {options.map(option => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                selected
                  ? 'border border-border/80 bg-background font-semibold text-foreground shadow-2xs'
                  : 'border border-transparent text-muted-foreground hover:bg-background/40 hover:text-foreground'
              )}
            >
              <span>{option.label}</span>
              {option.count !== undefined && (
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    selected ? 'font-semibold text-primary' : 'text-muted-foreground/80'
                  )}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** View picker for the Filters popover; every view stays one keyboard path away. */
function LiveViewPicker() {
  const { query, setQuery, snapshot } = useLiveDashboard();
  const counts = new Map(Object.entries(snapshot?.facets.views ?? {}));
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        View
      </legend>
      <div
        role="radiogroup"
        aria-label="Live incident view"
        className="grid grid-cols-2 gap-1.5"
      >
        {LIVE_INCIDENT_VIEWS.map(view => {
          const active = query.view === view;
          const count = counts.get(view);
          return (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`live-view-${view}`}
              onClick={() => setQuery({ view })}
              className={cn(
                'flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                active
                  ? 'border-primary/60 bg-primary/10 font-semibold text-primary shadow-2xs'
                  : 'border-border/70 bg-card text-foreground hover:border-border hover:bg-muted/60'
              )}
            >
              <span className="truncate">{liveViewLabel(view)}</span>
              {count !== undefined && (
                <span
                  className={cn(
                    'rounded px-1 font-mono text-[10px] tabular-nums',
                    active ? 'bg-primary/20 font-bold text-primary' : 'bg-muted/60 text-muted-foreground'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function LiveToolbar({
  services,
  teams,
}: {
  services: LiveDirectoryOption[];
  teams: LiveDirectoryOption[];
}) {
  const { query, setQuery, snapshot } = useLiveDashboard();
  const facets = snapshot?.facets;
  const [search, setSearch] = useState(query.search);
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (syncedSearch !== query.search) {
    setSyncedSearch(query.search);
    setSearch(query.search);
  }
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const serviceOptions = useMemo(
    () => mergeOptions(services, facets?.services ?? []),
    [services, facets?.services]
  );
  const teamOptions = useMemo(
    () => mergeOptions(teams, facets?.teams ?? []),
    [teams, facets?.teams]
  );

  const onSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery({ search: value }), SEARCH_DEBOUNCE_MS);
  };

  const moreCount =
    (query.teamId ? 1 : 0) +
    (query.status !== 'all' ? 1 : 0) +
    (query.urgency !== 'all' ? 1 : 0) +
    (query.assignment !== 'all' ? 1 : 0);

  return (
    <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center justify-start gap-1.5 sm:basis-0 sm:flex-nowrap sm:justify-end">
      <div className="relative w-full min-w-[8rem] sm:w-auto sm:max-w-[24rem] sm:flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="live-incident-search"
          data-testid="live-search"
          value={search}
          onChange={event => onSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              onSearch('');
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search"
          aria-label="Search live incidents by title or service"
          aria-keyshortcuts="/"
          className={cn(controlClass, 'w-full pl-8 pr-7')}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:block">
          /
        </kbd>
      </div>
      <FacetCombobox
        label="Service"
        testId="live-filter-service"
        icon={<Briefcase className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden />}
        value={query.serviceId}
        options={serviceOptions}
        onChange={serviceId => setQuery({ serviceId })}
        className="max-w-[11rem] shrink-0"
        compactLabel
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            data-testid="live-more-filters"
            className={cn(
              controlClass,
              'gap-1.5 font-medium',
              moreCount > 0 && 'border-primary/50 bg-primary/5 text-primary'
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Filters
            {moreCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {moreCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={12}
          className="max-h-[min(38rem,var(--radix-popover-content-available-height))] w-[23rem] max-w-[calc(100vw-2rem)] space-y-3.5 overflow-y-auto overscroll-contain p-3.5 rounded-xl border border-border/80 shadow-xl dark:border-zinc-800 dark:shadow-2xl dark:shadow-black/60"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="text-xs font-semibold tracking-tight text-foreground">Filter Incidents</span>
              {moreCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.2 font-mono text-[10px] font-bold text-primary">
                  {moreCount} active
                </span>
              )}
            </div>
            {moreCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setQuery({
                    teamId: null,
                    status: 'all',
                    urgency: 'all',
                    assignment: 'all',
                  })
                }
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:underline"
              >
                Reset all
              </button>
            )}
          </div>
          <LiveViewPicker />
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Team
            </p>
            <FacetCombobox
              label="Team"
              testId="live-filter-team"
              icon={<Users className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />}
              value={query.teamId}
              options={teamOptions}
              onChange={teamId => setQuery({ teamId })}
              className="w-full"
            />
          </div>
          <Segmented
            label="Status"
            testId="live-filter-status"
            value={query.status}
            onChange={status => setQuery({ status })}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'OPEN', label: 'Triggered', count: facets?.status.OPEN },
              { value: 'ACKNOWLEDGED', label: 'Acked', count: facets?.status.ACKNOWLEDGED },
            ]}
          />
          <Segmented
            label="Urgency"
            testId="live-filter-urgency"
            value={query.urgency}
            onChange={urgency => setQuery({ urgency })}
            cols="grid-cols-4"
            options={[
              { value: 'all', label: 'Any' },
              { value: 'HIGH', label: 'High', count: facets?.urgency.HIGH },
              { value: 'MEDIUM', label: 'Med', count: facets?.urgency.MEDIUM },
              { value: 'LOW', label: 'Low', count: facets?.urgency.LOW },
            ]}
          />
          <Segmented
            label="Assignment"
            testId="live-filter-assignment"
            value={query.assignment}
            onChange={assignment => setQuery({ assignment })}
            options={[
              { value: 'all', label: 'Anyone' },
              { value: 'unassigned', label: 'Unassigned', count: facets?.assignment.unassigned },
              { value: 'assigned', label: 'Assigned', count: facets?.assignment.assigned },
            ]}
          />
          <p className="border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
            Snoozed and suppressed incidents are not active.{' '}
            <Link
              href="/incidents?filter=muted"
              className="font-medium text-primary hover:underline"
            >
              View muted incidents
            </Link>
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Removable chips for everything narrowing the feed, including a tile-selected view. */
export function LiveActiveFilters({
  services,
  teams,
}: {
  services: LiveDirectoryOption[];
  teams: LiveDirectoryOption[];
}) {
  const { query, setQuery, snapshot } = useLiveDashboard();
  const serviceName =
    snapshot?.facets.services.find(option => option.id === query.serviceId)?.name ??
    services.find(option => option.id === query.serviceId)?.name;
  const teamName =
    snapshot?.facets.teams.find(option => option.id === query.teamId)?.name ??
    teams.find(option => option.id === query.teamId)?.name;
  const chips: Array<{ key: string; label: string; clear: Partial<LiveIncidentQuery> }> = [];
  if (query.view !== 'active')
    chips.push({ key: 'view', label: liveViewLabel(query.view), clear: { view: 'active' } });
  if (query.serviceId)
    chips.push({ key: 'service', label: serviceName ?? 'Service', clear: { serviceId: null } });
  if (query.teamId)
    chips.push({ key: 'team', label: `Team: ${teamName ?? 'Selected'}`, clear: { teamId: null } });
  if (query.status !== 'all')
    chips.push({
      key: 'status',
      label: query.status === 'OPEN' ? 'Triggered' : 'Acknowledged',
      clear: { status: 'all' },
    });
  if (query.urgency !== 'all')
    chips.push({
      key: 'urgency',
      label: `${query.urgency.charAt(0)}${query.urgency.slice(1).toLowerCase()} urgency`,
      clear: { urgency: 'all' },
    });
  if (query.assignment !== 'all')
    chips.push({
      key: 'assignment',
      label: query.assignment === 'unassigned' ? 'Unassigned' : 'Assigned',
      clear: { assignment: 'all' },
    });
  if (query.search)
    chips.push({ key: 'search', label: `“${query.search}”`, clear: { search: '' } });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="live-filter-chips">
      <span className="text-[11px] font-medium text-muted-foreground">Filtered by</span>
      {chips.map(chip => (
        <button
          key={chip.key}
          type="button"
          onClick={() => setQuery(chip.clear)}
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-primary/10 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <X className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          data-testid="live-clear-filters"
          onClick={() =>
            setQuery({
              view: 'active',
              serviceId: null,
              teamId: null,
              status: 'all',
              urgency: 'all',
              assignment: 'all',
              search: '',
            })
          }
          className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
