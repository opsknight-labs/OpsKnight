'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Users, SearchX } from 'lucide-react';
import { EmptyState, FilterBar, FilterChip } from '@/components/patterns';
import Pagination from '@/components/service/Pagination';
import TeamDirectoryCard from './TeamDirectoryCard';

type TeamItem = {
  id: string;
  name: string;
  description?: string | null;
  teamLead?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  members: Array<{
    userId: string;
    role: string;
    user: {
      id?: string;
      name: string;
      avatarUrl?: string | null;
      gender?: string | null;
    };
  }>;
  services: Array<{
    id: string;
    name: string;
  }>;
  _count: {
    members: number;
    services: number;
  };
};

type TeamDirectoryListProps = {
  teams: TeamItem[];
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  filterCounts?: {
    total: number;
    configured: number;
    needsLead: number;
  };
  currentSearch?: string;
  currentStatus?: string;
  /** Create action shown in the first-run empty state. */
  createAction?: ReactNode;
};

export default function TeamDirectoryList({
  teams,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
  createAction,
}: TeamDirectoryListProps) {
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
      router.push(qs ? `/teams?${qs}` : '/teams');
    });
  };

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? teams.length;
  const needsLeadCount = filterCounts?.needsLead ?? 0;
  const statusFilters = [
    { value: 'all', label: 'All', count: totalCount },
    { value: 'configured', label: 'Configured', count: filterCounts?.configured ?? 0 },
    ...(needsLeadCount > 0 || currentStatus === 'needs-lead'
      ? [{ value: 'needs-lead', label: 'Needs a lead', count: needsLeadCount }]
      : []),
  ];
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));
  const clearFilters = () => updateFilters({ q: '', status: 'all' });

  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <EmptyState
        variant="card"
        size="lg"
        icon={<Users />}
        title="No teams yet"
        description="Teams group responders, own services and receive escalations as one unit. Create a team, choose a lead, then add members and the services they own."
        primaryAction={createAction}
      />
    );
  }

  return (
    <div className="space-y-4" aria-busy={isPending || undefined}>
      <FilterBar
        search={{
          value: currentSearch,
          onChange: q => updateFilters({ q }),
          placeholder: 'Search by team, member or service…',
          label: 'Search teams',
          debounceMs: 300,
        }}
        chips={statusFilters.map(filter => (
          <FilterChip
            key={filter.value}
            active={currentStatus === filter.value}
            count={filter.count}
            onClick={() => updateFilters({ status: filter.value })}
          >
            {filter.label}
          </FilterChip>
        ))}
        hasActiveFilters={hasActiveFilter}
        onClearAll={clearFilters}
      />

      {teams.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No teams match these filters"
          description={
            currentSearch
              ? `Nothing matched “${currentSearch}”. Try a member name or a service the team owns.`
              : 'No teams match the selected filter.'
          }
          primaryAction={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {teams.map(team => (
            <TeamDirectoryCard key={team.id} team={team} />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
          itemLabel="team"
        />
      )}
    </div>
  );
}
