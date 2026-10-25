'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
}: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  value: string | null;
  options: LiveFacetOption[];
  onChange: (id: string | null) => void;
  className?: string;
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
            value && 'border-primary/50 bg-primary/5 text-primary',
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {icon}
            <span className="truncate">{selected?.name ?? `All ${label.toLowerCase()}s`}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[18rem] rounded-lg p-0 shadow-lg" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}s…`} className="h-8 text-xs" />
          <CommandList className="max-h-[280px]">
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
                className="cursor-pointer text-xs"
              >
                <span className="flex-1">All {label.toLowerCase()}s</span>
                {!value && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
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
                  className="cursor-pointer text-xs"
                >
                  <span className="flex-1 truncate">{option.name}</span>
                  {option.critical > 0 && (
                    <span className="ml-2 rounded bg-rose-500/10 px-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                      {option.critical} crit
                    </span>
                  )}
                  <span
                    className={cn(
                      'ml-2 min-w-6 rounded px-1 text-center text-[10px] font-semibold tabular-nums',
                      option.count > 0 ? 'bg-muted text-foreground' : 'text-muted-foreground/60'
                    )}
                  >
                    {option.count}
                  </span>
                  {option.id === value && (
                    <Check className="ml-1 h-3.5 w-3.5 text-primary" aria-hidden />
                  )}
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
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  testId: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-3 gap-1"
        data-testid={testId}
      >
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-value={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              value === option.value
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground hover:bg-muted'
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="ml-1 tabular-nums text-muted-foreground">{option.count}</span>
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function LiveViewTabs() {
  const { query, setQuery, snapshot } = useLiveDashboard();
  const counts = new Map(Object.entries(snapshot?.facets.views ?? {}));
  return (
    <div
      role="tablist"
      aria-label="Live incident views"
      className="flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5 [scrollbar-width:none]"
    >
      {LIVE_INCIDENT_VIEWS.map(view => {
        const active = query.view === view;
        const count = counts.get(view);
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`live-view-${view}`}
            onClick={() => setQuery({ view })}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-primary/50',
              active
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {liveViewLabel(view)}
            {count !== undefined && (
              <span
                className={cn(
                  'rounded px-1 text-[10px] tabular-nums',
                  view === 'breaching' && count > 0
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    : view === 'critical' && count > 0
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One compact row: search, service and a "More" popover for the remaining facets.
 * Active facets render as removable chips underneath, so the feed never jumps around.
 */
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

  const chips: Array<{ key: string; label: string; clear: Partial<LiveIncidentQuery> }> = [];
  if (query.serviceId)
    chips.push({
      key: 'service',
      label: serviceOptions.find(option => option.id === query.serviceId)?.name ?? 'Service',
      clear: { serviceId: null },
    });
  if (query.teamId)
    chips.push({
      key: 'team',
      label: `Team: ${teamOptions.find(option => option.id === query.teamId)?.name ?? 'Selected'}`,
      clear: { teamId: null },
    });
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
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
            placeholder="Search title or service"
            aria-label="Search live incidents"
            aria-keyshortcuts="/"
            className={cn(controlClass, 'w-full pl-8 pr-8')}
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
          className="w-full max-w-[13rem] sm:w-auto"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              data-testid="live-more-filters"
              className={cn(
                controlClass,
                'gap-1.5 font-semibold',
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
          <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] space-y-3 p-3">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            <fieldset>
              <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Urgency
              </legend>
              <div
                role="radiogroup"
                aria-label="Urgency"
                className="grid grid-cols-4 gap-1"
                data-testid="live-filter-urgency"
              >
                {(
                  [
                    ['all', 'Any', undefined],
                    ['HIGH', 'High', facets?.urgency.HIGH],
                    ['MEDIUM', 'Med', facets?.urgency.MEDIUM],
                    ['LOW', 'Low', facets?.urgency.LOW],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={query.urgency === value}
                    data-value={value}
                    onClick={() => setQuery({ urgency: value })}
                    className={cn(
                      'rounded-md border px-1.5 py-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                      query.urgency === value
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-card text-foreground hover:bg-muted'
                    )}
                  >
                    {label}
                    {count !== undefined && (
                      <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
            <Segmented
              label="Assignment"
              testId="live-filter-assignment"
              value={query.assignment}
              onChange={assignment => setQuery({ assignment })}
              options={[
                { value: 'all', label: 'Anyone' },
                {
                  value: 'unassigned',
                  label: 'Unassigned',
                  count: facets?.assignment.unassigned,
                },
                { value: 'assigned', label: 'Assigned', count: facets?.assignment.assigned },
              ]}
            />
          </PopoverContent>
        </Popover>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="live-filter-chips">
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
      )}
    </div>
  );
}
