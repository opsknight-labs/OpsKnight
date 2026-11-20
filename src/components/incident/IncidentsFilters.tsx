'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Button } from '@/components/ui/shadcn/button';
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';
import {
  Flame,
  AlertCircle,
  MinusCircle,
  Server,
  Check,
  ChevronsUpDown,
  Layers,
} from 'lucide-react';

type IncidentsFiltersProps = {
  currentFilter: string;
  currentSort?: string;
  currentPriority?: string;
  currentUrgency?: string;
  currentSearch?: string;
  currentTeamId?: string;
  currentServiceId?: string;
  teams?: Array<{ id: string; name: string }>;
  services?: Array<{ id: string; name: string }>;
  canCreateIncident?: boolean;
  /** Noise-decision filter; shown only when the viewer may read intelligence. */
  showNoiseFilter?: boolean;
  currentNoise?: string;
};

const TRIGGER = 'h-9 text-sm';

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}

export default function IncidentsFilters({
  currentFilter,
  currentSort = 'newest',
  currentPriority = 'all',
  currentUrgency = 'all',
  currentSearch = '',
  currentTeamId = 'all',
  currentServiceId = 'all',
  teams = [],
  services = [],
  canCreateIncident = false,
  showNoiseFilter = false,
  currentNoise = 'all',
}: IncidentsFiltersProps) {
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [serviceOpen, setServiceOpen] = useState(false);

  const updateParams = useCallback(
    (updates: Record<string, string>, { replace = false }: { replace?: boolean } = {}) => {
      const currentQuery = searchParams.toString();
      const params = new URLSearchParams(currentQuery);
      params.delete('page');
      Object.entries(updates).forEach(([key, value]) => {
        if (key === 'filter') {
          params.delete('status');
          if (value === '' || value === 'all') {
            params.delete(key);
          } else {
            params.set(key, value);
          }
          return;
        }
        if (value === 'all' || value === '' || value === 'newest') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      const nextQuery = params.toString();
      if (nextQuery === currentQuery) return;
      startTransition(() => {
        const nextUrl = nextQuery ? `/incidents?${nextQuery}` : '/incidents';
        // Keep scroll position; search replaces history so Back isn't one entry per keystroke.
        if (replace) router.replace(nextUrl, { scroll: false });
        else router.push(nextUrl, { scroll: false });
      });
    },
    [router, searchParams, startTransition]
  );

  const onSearchChange = useCallback(
    (value: string) => {
      const term = value.trim();
      // A single character matches nearly everything; wait for a second one.
      if (term.length === 1) return;
      updateParams({ search: term }, { replace: true });
    },
    [updateParams]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/incidents', { scroll: false });
    });
  };

  const serviceActive = currentServiceId !== 'all' && currentServiceId !== '';
  const noiseActive = currentNoise !== 'all';
  const advancedActiveCount =
    Number(serviceActive) + Number(currentSort !== 'newest') + Number(noiseActive);

  const hasActiveFilters =
    currentSearch !== '' ||
    currentPriority !== 'all' ||
    currentUrgency !== 'all' ||
    currentSort !== 'newest' ||
    currentFilter !== 'all' ||
    currentTeamId !== 'all' ||
    noiseActive ||
    serviceActive;

  const toggleFilter = (value: string) =>
    updateParams({ filter: currentFilter === value ? 'all' : value, teamId: 'all' });
  const toggleUrgency = (value: string) =>
    updateParams({ urgency: currentUrgency === value ? 'all' : value });

  const chips = (
    <>
      <FilterChip
        active={currentFilter === 'all' && currentTeamId === 'all'}
        onClick={() => updateParams({ filter: 'all', teamId: 'all' })}
      >
        All incidents
      </FilterChip>
      <FilterChip active={currentFilter === 'all_open'} onClick={() => toggleFilter('all_open')}>
        Active
      </FilterChip>
      <FilterChip active={currentFilter === 'mine'} onClick={() => toggleFilter('mine')}>
        Mine
      </FilterChip>
      <FilterChip
        active={currentFilter === 'acknowledged'}
        onClick={() => toggleFilter('acknowledged')}
      >
        Acknowledged
      </FilterChip>
      {teams.length > 0 && (
        <FilterChip
          active={currentTeamId === 'mine'}
          onClick={() => updateParams({ teamId: currentTeamId === 'mine' ? 'all' : 'mine' })}
        >
          My teams
        </FilterChip>
      )}
      <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border sm:block" />
      <FilterChip
        active={currentUrgency === 'all'}
        onClick={() => updateParams({ urgency: 'all' })}
      >
        All urgency
      </FilterChip>
      <FilterChip
        tone="critical"
        icon={<Flame />}
        active={currentUrgency === 'HIGH'}
        onClick={() => toggleUrgency('HIGH')}
      >
        High urgency
      </FilterChip>
      <FilterChip
        tone="elevated"
        icon={<AlertCircle />}
        active={currentUrgency === 'MEDIUM'}
        onClick={() => toggleUrgency('MEDIUM')}
      >
        Medium urgency
      </FilterChip>
      <FilterChip
        tone="info"
        icon={<MinusCircle />}
        active={currentUrgency === 'LOW'}
        onClick={() => toggleUrgency('LOW')}
      >
        Low urgency
      </FilterChip>
    </>
  );

  const filters = (
    <>
      <FilterField label="Status" htmlFor="incident-filter-status">
        <Select value={currentFilter} onValueChange={val => updateParams({ filter: val })}>
          <SelectTrigger id="incident-filter-status" className={`${TRIGGER} w-[150px]`}>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="all_open">
              <div className="flex items-center gap-2">
                <Dot className="bg-rose-500" />
                <span>Active</span>
              </div>
            </SelectItem>
            <SelectItem value="open">
              <div className="flex items-center gap-2">
                <Dot className="bg-rose-500" />
                <span>Triggered</span>
              </div>
            </SelectItem>
            <SelectItem value="acknowledged">
              <div className="flex items-center gap-2">
                <Dot className="bg-amber-500" />
                <span>Acknowledged</span>
              </div>
            </SelectItem>
            <SelectItem value="mine">
              <div className="flex items-center gap-2">
                <Dot className="bg-blue-500" />
                <span>My incidents</span>
              </div>
            </SelectItem>
            <SelectItem value="resolved">
              <div className="flex items-center gap-2">
                <Dot className="bg-slate-500" />
                <span>Resolved</span>
              </div>
            </SelectItem>
            <SelectItem value="muted">
              <div className="flex items-center gap-2">
                <Dot className="bg-violet-500" />
                <span>Muted (Snoozed + Suppressed)</span>
              </div>
            </SelectItem>
            <SelectItem value="snoozed">
              <div className="flex items-center gap-2">
                <Dot className="bg-yellow-500" />
                <span>Snoozed</span>
              </div>
            </SelectItem>
            <SelectItem value="suppressed">
              <div className="flex items-center gap-2">
                <Dot className="bg-gray-400" />
                <span>Suppressed</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Priority" htmlFor="incident-filter-priority">
        <Select value={currentPriority} onValueChange={val => updateParams({ priority: val })}>
          <SelectTrigger id="incident-filter-priority" className={`${TRIGGER} w-[150px]`}>
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="P1">
              <div className="flex items-center gap-2">
                <Dot className="animate-pulse bg-rose-600" />
                <span>P1 - Critical</span>
              </div>
            </SelectItem>
            <SelectItem value="P2">
              <div className="flex items-center gap-2">
                <Dot className="bg-orange-500" />
                <span>P2 - High</span>
              </div>
            </SelectItem>
            <SelectItem value="P3">
              <div className="flex items-center gap-2">
                <Dot className="bg-yellow-500" />
                <span>P3 - Medium</span>
              </div>
            </SelectItem>
            <SelectItem value="P4">
              <div className="flex items-center gap-2">
                <Dot className="bg-blue-500" />
                <span>P4 - Low</span>
              </div>
            </SelectItem>
            <SelectItem value="P5">
              <div className="flex items-center gap-2">
                <Dot className="bg-slate-500" />
                <span>P5 - Info</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Team" htmlFor="incident-filter-team">
        <Select value={currentTeamId} onValueChange={val => updateParams({ teamId: val })}>
          <SelectTrigger id="incident-filter-team" className={`${TRIGGER} w-[150px]`}>
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.length > 0 && <SelectItem value="mine">My teams</SelectItem>}
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Urgency" htmlFor="incident-filter-urgency">
        <Select value={currentUrgency} onValueChange={val => updateParams({ urgency: val })}>
          <SelectTrigger id="incident-filter-urgency" className={`${TRIGGER} w-[150px]`}>
            <SelectValue placeholder="All urgency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgency</SelectItem>
            <SelectItem value="HIGH">
              <div className="flex items-center gap-2">
                <Dot className="bg-rose-500" />
                <span>High</span>
              </div>
            </SelectItem>
            <SelectItem value="MEDIUM">
              <div className="flex items-center gap-2">
                <Dot className="bg-amber-500" />
                <span>Medium</span>
              </div>
            </SelectItem>
            <SelectItem value="LOW">
              <div className="flex items-center gap-2">
                <Dot className="bg-blue-500" />
                <span>Low</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </FilterField>
    </>
  );

  const advanced = (
    <>
      {services.length > 0 && (
        <FilterField label="Service">
          <Popover open={serviceOpen} onOpenChange={setServiceOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={serviceOpen}
                aria-label="Filter by service"
                className="h-9 w-full justify-between px-3 text-sm font-normal"
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <Server className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">
                    {serviceActive
                      ? services.find(s => s.id === currentServiceId)?.name || 'All services'
                      : 'All services'}
                  </span>
                </span>
                <ChevronsUpDown
                  className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50"
                  aria-hidden="true"
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0 shadow-lg"
              align="start"
            >
              <Command>
                <CommandInput placeholder="Search services..." className="h-9 text-xs" />
                <CommandList className="max-h-[240px]">
                  <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                    No services found.
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="All services all"
                      onSelect={() => {
                        updateParams({ serviceId: '' });
                        setServiceOpen(false);
                      }}
                      className="flex cursor-pointer items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>All services</span>
                      </div>
                      {!serviceActive && (
                        <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </CommandItem>
                    {services.map(service => (
                      <CommandItem
                        key={service.id}
                        value={`${service.name} ${service.id}`}
                        onSelect={() => {
                          updateParams({ serviceId: service.id });
                          setServiceOpen(false);
                        }}
                        className="flex cursor-pointer items-center justify-between text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2 truncate">
                          <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{service.name}</span>
                        </div>
                        {service.id === currentServiceId && (
                          <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </FilterField>
      )}

      {showNoiseFilter && (
        <FilterField label="Noise decisions" htmlFor="incident-filter-noise">
          <Select value={currentNoise} onValueChange={val => updateParams({ noise: val })}>
            <SelectTrigger id="incident-filter-noise" className={`${TRIGGER} w-[190px]`}>
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <SelectValue placeholder="Any" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              <SelectItem value="grouped">Grouped</SelectItem>
              <SelectItem value="suppressed">Suppressed by a rule</SelectItem>
              <SelectItem value="maintenance">In maintenance</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
      )}

      <FilterField label="Sort" htmlFor="incident-filter-sort">
        <Select value={currentSort} onValueChange={val => updateParams({ sort: val })}>
          <SelectTrigger id="incident-filter-sort" className={TRIGGER}>
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="priority">Priority (P1-P5)</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="updated">Recently updated</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>
    </>
  );

  const actions = (
    <>
      {isPending && (
        <span role="status" className="animate-pulse text-xs text-muted-foreground">
          Loading…
        </span>
      )}
      {canCreateIncident && (
        <Button
          size="sm"
          className="h-9 px-3.5 text-xs font-semibold"
          onClick={() => openCreateIncident()}
        >
          Create incident
        </Button>
      )}
    </>
  );

  return (
    <div>
      <FilterBar
        search={{
          value: currentSearch,
          onChange: onSearchChange,
          placeholder: 'Title, description, or ID',
          label: 'Search incidents',
          // IncidentsListTable focuses #incident-search on "/".
          id: 'incident-search',
          debounceMs: 400,
        }}
        chips={chips}
        filters={filters}
        advanced={advanced}
        advancedLabel="Service & sort"
        advancedActiveCount={advancedActiveCount}
        defaultAdvancedOpen={advancedActiveCount > 0}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearFilters}
        actions={canCreateIncident || isPending ? actions : undefined}
      />
    </div>
  );
}
