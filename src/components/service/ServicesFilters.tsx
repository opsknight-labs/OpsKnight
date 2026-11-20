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
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';
import { AlertTriangle, ArrowUpDown, CheckCircle2, XCircle } from 'lucide-react';

type ServicesFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
  currentTeam?: string;
  currentSort?: string;
  teams: Array<{ id: string; name: string }>;
};

export function useServicesParams() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const currentQuery = searchParams.toString();
      const params = new URLSearchParams(currentQuery);

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
  return { updateParams, startTransition, router };
}

export default function ServicesFilters({
  currentSearch = '',
  currentStatus = 'all',
  currentTeam = 'all',
  currentSort = 'name_asc',
  teams,
}: ServicesFiltersProps) {
  const { updateParams, startTransition, router } = useServicesParams();

  const clearFilters = () => {
    startTransition(() => {
      router.push('/services');
    });
  };

  const hasActiveFilters =
    currentSearch !== '' ||
    currentStatus !== 'all' ||
    (currentTeam || 'all') !== 'all' ||
    currentSort !== 'name_asc';

  const toggleStatus = (value: string) =>
    updateParams({ status: currentStatus === value ? 'all' : value });

  return (
    <FilterBar
      chips={
        <>
          <FilterChip
            active={currentStatus === 'all'}
            onClick={() => updateParams({ status: 'all' })}
          >
            All services
          </FilterChip>
          <FilterChip
            tone="ok"
            icon={<CheckCircle2 />}
            active={currentStatus === 'OPERATIONAL'}
            onClick={() => toggleStatus('OPERATIONAL')}
          >
            Operational
          </FilterChip>
          <FilterChip
            tone="elevated"
            icon={<AlertTriangle />}
            active={currentStatus === 'DEGRADED'}
            onClick={() => toggleStatus('DEGRADED')}
          >
            Degraded
          </FilterChip>
          <FilterChip
            tone="critical"
            icon={<XCircle />}
            active={currentStatus === 'CRITICAL'}
            onClick={() => toggleStatus('CRITICAL')}
          >
            Critical
          </FilterChip>
        </>
      }
      search={{
        value: currentSearch,
        onChange: value => updateParams({ search: value }),
        placeholder: 'Search services by name…',
        label: 'Search services',
        debounceMs: 300,
      }}
      hasActiveFilters={hasActiveFilters}
      onClearAll={clearFilters}
      filters={
        <>
          <FilterField label="Team" htmlFor="services-filter-team">
            <Select
              value={currentTeam || 'all'}
              onValueChange={value => updateParams({ team: value })}
            >
              <SelectTrigger id="services-filter-team" className="h-9 w-[170px] text-sm">
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
          <FilterField label="Status" htmlFor="services-filter-status">
            <Select value={currentStatus} onValueChange={value => updateParams({ status: value })}>
              <SelectTrigger id="services-filter-status" className="h-9 w-[160px] text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="OPERATIONAL">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    Operational
                  </div>
                </SelectItem>
                <SelectItem value="DEGRADED">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                    Degraded
                  </div>
                </SelectItem>
                <SelectItem value="CRITICAL">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
                    Critical
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
    />
  );
}

const SORT_OPTIONS = [
  ['name_asc', 'Name (A-Z)'],
  ['name_desc', 'Name (Z-A)'],
  ['status', 'Status health'],
  ['incidents_desc', 'Most incidents'],
  ['incidents_asc', 'Least incidents'],
] as const;

/** Sort control for the service directory header. */
export function ServicesSortSelect({ currentSort = 'name_asc' }: { currentSort?: string }) {
  const { updateParams } = useServicesParams();
  return (
    <Select value={currentSort} onValueChange={value => updateParams({ sort: value })}>
      <SelectTrigger aria-label="Sort services" className="h-8 w-auto gap-1.5 text-xs">
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue placeholder="Sort order" />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
