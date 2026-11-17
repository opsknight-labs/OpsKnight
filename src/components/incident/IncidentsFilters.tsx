'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
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
import FilterBar, { FilterChip, FilterField } from '@/components/patterns/FilterBar';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';

/** Accessible name of the incident search box; the `/` shortcut focuses it by this label. */
export const INCIDENT_SEARCH_LABEL = 'Search incidents';

type IncidentsFiltersProps = {
  currentFilter: string;
  /** Exact status from a drill-down link (`?status=OPEN`). */
  currentStatus?: string;
  currentSort?: string;
  currentPriority?: string;
  currentUrgency?: string;
  currentSearch?: string;
  currentTeamId?: string;
  currentServiceId?: string;
  currentAssignee?: string;
  createdAfter?: string;
  createdBefore?: string;
  teams?: Array<{ id: string; name: string }>;
  services?: Array<{ id: string; name: string }>;
};

const STATUS_TABS = [
  { filter: 'all_open', label: 'Active', status: null },
  { filter: 'open', label: 'Triggered', status: 'OPEN' },
  { filter: 'acknowledged', label: 'Acknowledged', status: 'ACKNOWLEDGED' },
  { filter: 'resolved', label: 'Resolved', status: 'RESOLVED' },
  { filter: 'mine', label: 'Mine', status: null },
] as const;

const MUTED_FILTERS = ['muted', 'snoozed', 'suppressed'] as const;

/** Advanced filters that are set, so the section can open itself and show a count. */
export function countActiveAdvancedFilters({
  currentFilter,
  currentStatus,
  currentPriority = 'all',
  currentAssignee,
  createdAfter,
  createdBefore,
}: Pick<
  IncidentsFiltersProps,
  | 'currentFilter'
  | 'currentStatus'
  | 'currentPriority'
  | 'currentAssignee'
  | 'createdAfter'
  | 'createdBefore'
>): number {
  const mutedActive =
    (MUTED_FILTERS as readonly string[]).includes(currentFilter) ||
    currentStatus === 'SNOOZED' ||
    currentStatus === 'SUPPRESSED';
  return [
    currentPriority !== 'all' && currentPriority !== '',
    Boolean(currentAssignee),
    Boolean(createdAfter),
    Boolean(createdBefore),
    mutedActive,
  ].filter(Boolean).length;
}

function toDateInput(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

const triggerClass = 'h-9 w-full bg-background text-sm sm:min-w-[10rem]';
// Two selects per row on phones, natural width from `sm`.
const fieldClass = 'min-w-[7.5rem] flex-1 sm:flex-none';

export default function IncidentsFilters({
  currentFilter,
  currentStatus,
  currentSort = 'newest',
  currentPriority = 'all',
  currentUrgency = 'all',
  currentSearch = '',
  currentTeamId = 'all',
  currentServiceId = 'all',
  currentAssignee,
  createdAfter,
  createdBefore,
  teams = [],
  services = [],
}: IncidentsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [serviceOpen, setServiceOpen] = useState(false);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
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
        router.push(nextUrl);
      });
    },
    [router, searchParams, startTransition]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/incidents');
    });
  };

  const hasServiceFilter = Boolean(currentServiceId && currentServiceId !== 'all');
  const hasActiveFilters =
    currentSearch !== '' ||
    currentPriority !== 'all' ||
    currentUrgency !== 'all' ||
    currentSort !== 'newest' ||
    currentFilter !== 'all' ||
    Boolean(currentStatus) ||
    currentTeamId !== 'all' ||
    hasServiceFilter ||
    Boolean(currentAssignee) ||
    Boolean(createdAfter) ||
    Boolean(createdBefore);

  const advancedActiveCount = countActiveAdvancedFilters({
    currentFilter,
    currentStatus,
    currentPriority,
    currentAssignee,
    createdAfter,
    createdBefore,
  });

  const isTabActive = (tab: (typeof STATUS_TABS)[number]) =>
    currentFilter === tab.filter ||
    (currentFilter === 'all' && tab.status !== null && currentStatus === tab.status);
  const isAllActive =
    currentFilter === 'all' &&
    (!currentStatus || !STATUS_TABS.some(tab => tab.status === currentStatus)) &&
    !(currentStatus === 'SNOOZED' || currentStatus === 'SUPPRESSED');

  const mutedValue = (MUTED_FILTERS as readonly string[]).includes(currentFilter)
    ? currentFilter
    : currentStatus === 'SNOOZED'
      ? 'snoozed'
      : currentStatus === 'SUPPRESSED'
        ? 'suppressed'
        : 'all';

  const assigneeValue = !currentAssignee
    ? 'all'
    : currentAssignee.toLowerCase() === 'unassigned'
      ? 'unassigned'
      : currentAssignee;

  const selectedServiceName = hasServiceFilter
    ? services.find(s => s.id === currentServiceId)?.name || 'All'
    : 'All';

  return (
    <FilterBar
      // Remount when an advanced filter becomes active (e.g. via a drill-down link) so the
      // section opens itself; it otherwise keeps whatever the user last chose.
      key={advancedActiveCount > 0 ? 'advanced-active' : 'advanced-idle'}
      search={{
        value: currentSearch,
        onChange: value => updateParams({ search: value.trim() === '' ? '' : value }),
        placeholder: 'Search title, description or ID',
        label: INCIDENT_SEARCH_LABEL,
        debounceMs: 300,
      }}
      chips={
        <>
          <FilterChip active={isAllActive} onClick={() => updateParams({ filter: 'all' })}>
            All
          </FilterChip>
          {STATUS_TABS.map(tab => {
            const active = isTabActive(tab);
            return (
              <FilterChip
                key={tab.filter}
                active={active}
                onClick={() => updateParams({ filter: active ? 'all' : tab.filter })}
              >
                {tab.label}
              </FilterChip>
            );
          })}
        </>
      }
      filters={
        <>
          <FilterField label="Urgency" htmlFor="incident-filter-urgency" className={fieldClass}>
            <Select value={currentUrgency} onValueChange={val => updateParams({ urgency: val })}>
              <SelectTrigger id="incident-filter-urgency" className={triggerClass}>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Team" htmlFor="incident-filter-team" className={fieldClass}>
            <Select value={currentTeamId} onValueChange={val => updateParams({ teamId: val })}>
              <SelectTrigger id="incident-filter-team" className={triggerClass}>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {teams.length > 0 && <SelectItem value="mine">My teams</SelectItem>}
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          {services.length > 0 && (
            <FilterField label="Service" className={fieldClass}>
              <Popover open={serviceOpen} onOpenChange={setServiceOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={serviceOpen}
                    aria-label="Filter by service"
                    className="h-9 w-full justify-between bg-background px-3 text-sm font-normal sm:min-w-[12rem]"
                  >
                    <span className="truncate">{selectedServiceName}</span>
                    <ChevronsUpDown
                      className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0"
                  align="start"
                >
                  <Command>
                    <CommandInput placeholder="Search services…" className="h-9 text-sm" />
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
                          className="flex items-center justify-between text-sm"
                        >
                          <span>All services</span>
                          {!hasServiceFilter && (
                            <Check className="ml-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="truncate">{service.name}</span>
                            {service.id === currentServiceId && (
                              <Check className="ml-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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

          <FilterField label="Sort" htmlFor="incident-filter-sort" className={fieldClass}>
            <Select value={currentSort} onValueChange={val => updateParams({ sort: val })}>
              <SelectTrigger id="incident-filter-sort" className={triggerClass}>
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="priority">Priority (P1–P5)</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="updated">Recently updated</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
      advanced={
        <>
          <FilterField label="Priority" htmlFor="incident-filter-priority" className="min-w-0">
            <Select value={currentPriority} onValueChange={val => updateParams({ priority: val })}>
              <SelectTrigger id="incident-filter-priority" className={triggerClass}>
                <SelectValue placeholder="Any priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any priority</SelectItem>
                <SelectItem value="P1">P1 · Critical</SelectItem>
                <SelectItem value="P2">P2 · High</SelectItem>
                <SelectItem value="P3">P3 · Medium</SelectItem>
                <SelectItem value="P4">P4 · Low</SelectItem>
                <SelectItem value="P5">P5 · Info</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Assignee" htmlFor="incident-filter-assignee" className="min-w-0">
            <Select value={assigneeValue} onValueChange={val => updateParams({ assignee: val })}>
              <SelectTrigger id="incident-filter-assignee" className={triggerClass}>
                <SelectValue placeholder="Anyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assigneeValue !== 'all' && assigneeValue !== 'unassigned' && (
                  <SelectItem value={assigneeValue}>Specific responder</SelectItem>
                )}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Muted" htmlFor="incident-filter-muted" className="min-w-0">
            <Select value={mutedValue} onValueChange={val => updateParams({ filter: val })}>
              <SelectTrigger id="incident-filter-muted" className={triggerClass}>
                <SelectValue placeholder="Not filtered" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Not filtered</SelectItem>
                <SelectItem value="muted">Snoozed or suppressed</SelectItem>
                <SelectItem value="snoozed">Snoozed</SelectItem>
                <SelectItem value="suppressed">Suppressed</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Created after" htmlFor="incident-filter-after" className="min-w-0">
              <Input
                id="incident-filter-after"
                type="date"
                value={toDateInput(createdAfter)}
                max={toDateInput(createdBefore) || undefined}
                onChange={e => updateParams({ createdAfter: e.target.value })}
                className="h-9 bg-background text-sm tabular-nums"
              />
            </FilterField>
            <FilterField
              label="Created before"
              htmlFor="incident-filter-before"
              className="min-w-0"
            >
              <Input
                id="incident-filter-before"
                type="date"
                value={toDateInput(createdBefore)}
                min={toDateInput(createdAfter) || undefined}
                onChange={e =>
                  updateParams({
                    // Inclusive: "before" a date keeps incidents from that whole day.
                    createdBefore: e.target.value ? `${e.target.value}T23:59:59.999Z` : '',
                  })
                }
                className="h-9 bg-background text-sm tabular-nums"
              />
            </FilterField>
          </div>
        </>
      }
      advancedActiveCount={advancedActiveCount}
      defaultAdvancedOpen={advancedActiveCount > 0}
      hasActiveFilters={hasActiveFilters}
      onClearAll={clearFilters}
      actions={
        isPending ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
            Updating…
          </span>
        ) : undefined
      }
    />
  );
}
