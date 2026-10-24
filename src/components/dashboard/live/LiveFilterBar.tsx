'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, Check, ChevronsUpDown, Search, Users, X } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  LIVE_INCIDENT_VIEWS,
  LIVE_VIEW_LABELS,
  countActiveFacets,
  type LiveFacetOption,
  type LiveIncidentQuery,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';

export type LiveDirectoryOption = { id: string; name: string };

const SEARCH_DEBOUNCE_MS = 250;
const triggerClass =
  'h-8 text-xs bg-card border-border hover:border-slate-300 rounded-lg shadow-2xs px-2.5';

function mergeOptions(
  directory: LiveDirectoryOption[],
  facets: LiveFacetOption[]
): Array<LiveFacetOption> {
  const byId = new Map(facets.map(option => [option.id, option]));
  const merged = facets.slice();
  for (const entry of directory) {
    if (!byId.has(entry.id)) merged.push({ ...entry, count: 0, critical: 0 });
  }
  return merged;
}

function FacetCombobox({
  label,
  icon,
  testId,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  value: string | null;
  options: LiveFacetOption[];
  onChange: (id: string | null) => void;
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
            triggerClass,
            'w-full justify-between font-normal',
            value && 'border-primary/50 bg-primary/5'
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {icon}
            <span className="truncate">
              {selected?.name ?? (value ? label : `All ${label.toLowerCase()}s`)}
            </span>
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[18rem] p-0 rounded-lg shadow-lg" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}s…`} className="h-8 text-xs" />
          <CommandList className="max-h-[260px]">
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
                      {option.critical}!
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

export function LiveViewTabs() {
  const { query, setQuery, snapshot } = useLiveDashboard();
  const counts = snapshot?.facets.views;
  return (
    <div
      role="tablist"
      aria-label="Live incident views"
      className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5 [scrollbar-width:none]"
    >
      {LIVE_INCIDENT_VIEWS.map(view => {
        const active = query.view === view;
        const count = counts?.[view];
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`live-view-${view}`}
            onClick={() => setQuery({ view })}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-primary/50',
              active
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {LIVE_VIEW_LABELS[view]}
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

export function LiveFilterBar({
  services,
  teams,
}: {
  services: LiveDirectoryOption[];
  teams: LiveDirectoryOption[];
}) {
  const { query, setQuery, snapshot } = useLiveDashboard();
  const facets = snapshot?.facets;
  const [search, setSearch] = useState(query.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setSearch(query.search), [query.search]);
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

  const chips: Array<{
    key: keyof LiveIncidentQuery;
    label: string;
    clear: Partial<LiveIncidentQuery>;
  }> = [];
  if (query.serviceId)
    chips.push({
      key: 'serviceId',
      label: `Service: ${serviceOptions.find(option => option.id === query.serviceId)?.name ?? 'Selected'}`,
      clear: { serviceId: null },
    });
  if (query.teamId)
    chips.push({
      key: 'teamId',
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
    chips.push({ key: 'urgency', label: `${query.urgency} urgency`, clear: { urgency: 'all' } });
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <div className="relative col-span-2 sm:col-span-3 xl:col-span-1">
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
            placeholder="Search live incidents  ( / )"
            aria-label="Search live incidents"
            className={cn(triggerClass, 'pl-8 w-full')}
          />
        </div>
        <FacetCombobox
          label="Service"
          testId="live-filter-service"
          icon={<Briefcase className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden />}
          value={query.serviceId}
          options={serviceOptions}
          onChange={serviceId => setQuery({ serviceId })}
        />
        <FacetCombobox
          label="Team"
          testId="live-filter-team"
          icon={<Users className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />}
          value={query.teamId}
          options={teamOptions}
          onChange={teamId => setQuery({ teamId })}
        />
        <Select
          value={query.status}
          onValueChange={value => setQuery({ status: value as LiveIncidentQuery['status'] })}
        >
          <SelectTrigger
            className={triggerClass}
            aria-label="Filter by status"
            data-testid="live-filter-status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="OPEN">Triggered ({facets?.status.OPEN ?? 0})</SelectItem>
            <SelectItem value="ACKNOWLEDGED">
              Acknowledged ({facets?.status.ACKNOWLEDGED ?? 0})
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={query.urgency}
          onValueChange={value => setQuery({ urgency: value as LiveIncidentQuery['urgency'] })}
        >
          <SelectTrigger
            className={triggerClass}
            aria-label="Filter by urgency"
            data-testid="live-filter-urgency"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgencies</SelectItem>
            <SelectItem value="HIGH">High ({facets?.urgency.HIGH ?? 0})</SelectItem>
            <SelectItem value="MEDIUM">Medium ({facets?.urgency.MEDIUM ?? 0})</SelectItem>
            <SelectItem value="LOW">Low ({facets?.urgency.LOW ?? 0})</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={query.assignment}
          onValueChange={value =>
            setQuery({ assignment: value as LiveIncidentQuery['assignment'] })
          }
        >
          <SelectTrigger
            className={triggerClass}
            aria-label="Filter by assignment"
            data-testid="live-filter-assignment"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            <SelectItem value="unassigned">
              Unassigned ({facets?.assignment.unassigned ?? 0})
            </SelectItem>
            <SelectItem value="assigned">Assigned ({facets?.assignment.assigned ?? 0})</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="live-filter-chips">
          {chips.map(chip => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setQuery(chip.clear)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label}
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          {countActiveFacets(query) > 1 && (
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
              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
