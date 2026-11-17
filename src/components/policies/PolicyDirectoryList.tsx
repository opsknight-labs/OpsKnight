'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { ShieldAlert, SearchX } from 'lucide-react';
import { EmptyState, FilterBar, FilterChip } from '@/components/patterns';
import PolicyDirectoryCard, { type PolicyDirectoryItem } from './PolicyDirectoryCard';
import Pagination from '@/components/service/Pagination';

type PolicyDirectoryListProps = {
  policies: PolicyDirectoryItem[];
  canManage?: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  filterCounts?: {
    total: number;
    inUse: number;
    unassigned: number;
  };
  currentSearch?: string;
  currentStatus?: string;
  /** Create action shown in the first-run empty state (admins only). */
  createAction?: ReactNode;
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'in-use', label: 'In use' },
  { value: 'unassigned', label: 'Unassigned' },
] as const;

export default function PolicyDirectoryList({
  policies,
  canManage = false,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
  createAction,
}: PolicyDirectoryListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateFilters = (newParams: { q?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newParams.q !== undefined) {
      const trimmed = newParams.q.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      params.delete('search');
    }
    if (newParams.status !== undefined) {
      if (newParams.status && newParams.status !== 'all') params.set('status', newParams.status);
      else params.delete('status');
    }
    params.delete('page');
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/policies?${qs}` : '/policies');
    });
  };

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? policies.length;
  const counts: Record<string, number> = {
    all: totalCount,
    'in-use': filterCounts?.inUse ?? 0,
    unassigned: filterCounts?.unassigned ?? 0,
  };
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));
  const clearFilters = () => updateFilters({ q: '', status: 'all' });

  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <EmptyState
        variant="card"
        size="lg"
        icon={<ShieldAlert />}
        title="No escalation policies yet"
        description="An escalation policy decides who gets paged for an incident and who is paged next if nobody acknowledges. Create one, add steps that target people, teams or on-call schedules, then attach it to your services."
        primaryAction={canManage ? createAction : undefined}
      />
    );
  }

  return (
    <div className="space-y-4" aria-busy={isPending || undefined}>
      <FilterBar
        search={{
          value: currentSearch,
          onChange: q => updateFilters({ q }),
          placeholder: 'Search by name, description or service…',
          label: 'Search escalation policies',
          debounceMs: 300,
        }}
        chips={STATUS_FILTERS.map(filter => (
          <FilterChip
            key={filter.value}
            active={currentStatus === filter.value}
            count={counts[filter.value]}
            onClick={() => updateFilters({ status: filter.value })}
          >
            {filter.label}
          </FilterChip>
        ))}
        hasActiveFilters={hasActiveFilter}
        onClearAll={clearFilters}
      />

      {policies.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {policies.map(policy => (
            <PolicyDirectoryCard key={policy.id} policy={policy} canManage={canManage} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<SearchX />}
          title="No escalation policies match these filters"
          description={
            currentSearch
              ? `Nothing matched “${currentSearch}”. Check the spelling or search by a service name.`
              : 'No escalation policies match the selected filter.'
          }
          primaryAction={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
          itemLabel="policy"
          itemLabelPlural="policies"
        />
      )}
    </div>
  );
}
