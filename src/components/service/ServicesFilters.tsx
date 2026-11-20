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
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

type ServicesFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
  currentTeam?: string;
  currentSort?: string;
  teams: Array<{ id: string; name: string }>;
};

export default function ServicesFilters({
  currentSearch = '',
  currentStatus = 'all',
  currentTeam = 'all',
  currentSort = 'name_asc',
  teams,
}: ServicesFiltersProps) {
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
          <FilterField label="Sort by" htmlFor="services-filter-sort">
            <Select value={currentSort} onValueChange={value => updateParams({ sort: value })}>
              <SelectTrigger id="services-filter-sort" className="h-9 w-[170px] text-sm">
                <SelectValue placeholder="Sort order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z-A)</SelectItem>
                <SelectItem value="status">Status health</SelectItem>
                <SelectItem value="incidents_desc">Most incidents</SelectItem>
                <SelectItem value="incidents_asc">Least incidents</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
    />
  );
}
