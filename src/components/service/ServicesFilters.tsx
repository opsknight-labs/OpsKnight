'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import FilterBar, { FilterChip, FilterField } from '@/components/patterns/FilterBar';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

type ServicesFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
  currentTeam?: string;
  currentSort?: string;
  teams: Array<{ id: string; name: string }>;
};

const STATUS_CHIPS = [
  { value: 'OPERATIONAL', label: 'Operational', icon: <CheckCircle2 /> },
  { value: 'DEGRADED', label: 'Degraded', icon: <AlertTriangle /> },
  { value: 'CRITICAL', label: 'Critical', icon: <XCircle /> },
] as const;

const triggerClass = 'h-9 w-full bg-background text-sm sm:min-w-[10rem]';
// Two selects per row on phones, natural width from `sm`.
const fieldClass = 'min-w-[7.5rem] flex-1 sm:flex-none';

export default function ServicesFilters({
  currentSearch = '',
  currentStatus = 'all',
  currentTeam = 'all',
  currentSort = 'name_asc',
  teams,
}: ServicesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const teamValue = currentTeam || 'all';

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const currentQuery = searchParams.toString();
      const params = new URLSearchParams(currentQuery);
      params.delete('page');

      Object.entries(updates).forEach(([key, value]) => {
        if (value === 'all' || value === '' || value === 'name_asc') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      const nextQuery = params.toString();
      if (nextQuery === currentQuery) return;

      startTransition(() => {
        const nextUrl = nextQuery ? `/services?${nextQuery}` : '/services';
        router.push(nextUrl);
      });
    },
    [router, searchParams]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/services');
    });
  };

  const hasActiveFilters =
    currentSearch !== '' ||
    currentStatus !== 'all' ||
    teamValue !== 'all' ||
    currentSort !== 'name_asc';

  return (
    <FilterBar
      search={{
        value: currentSearch,
        onChange: value => updateParams({ search: value.trim() === '' ? '' : value }),
        placeholder: 'Search services by name or description',
        label: 'Search services',
        debounceMs: 300,
      }}
      chips={
        <>
          <FilterChip
            active={currentStatus === 'all'}
            onClick={() => updateParams({ status: 'all' })}
          >
            All
          </FilterChip>
          {STATUS_CHIPS.map(chip => {
            const active = currentStatus === chip.value;
            return (
              <FilterChip
                key={chip.value}
                active={active}
                icon={chip.icon}
                onClick={() => updateParams({ status: active ? 'all' : chip.value })}
              >
                {chip.label}
              </FilterChip>
            );
          })}
        </>
      }
      filters={
        <>
          <FilterField label="Team" htmlFor="service-filter-team" className={fieldClass}>
            <Select value={teamValue} onValueChange={value => updateParams({ team: value })}>
              <SelectTrigger id="service-filter-team" className={triggerClass}>
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

          <FilterField label="Sort" htmlFor="service-filter-sort" className={fieldClass}>
            <Select value={currentSort} onValueChange={value => updateParams({ sort: value })}>
              <SelectTrigger id="service-filter-sort" className={triggerClass}>
                <SelectValue placeholder="Sort order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name (A–Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z–A)</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="incidents_desc">Most incidents</SelectItem>
                <SelectItem value="incidents_asc">Fewest incidents</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
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
