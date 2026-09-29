'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { X, Users, Loader2 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
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
};

export default function TeamDirectoryList({
  teams,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
}: TeamDirectoryListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(currentSearch);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSearchQuery(currentSearch);
  }, [currentSearch]);

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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchQuery });
  };

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? teams.length;
  const configuredCount = filterCounts?.configured ?? 0;
  const needsLeadCount = filterCounts?.needsLead ?? 0;
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));

  // Zero-teams total onboarding empty state (only when there are no teams at all across the tenant)
  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6 text-primary" />}
        title="Welcome to Teams"
        description="Teams group engineers, define incident escalation hierarchies, and attach service ownership. Create your first team above to get started."
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Search input */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Input
            value={searchQuery}
            onChange={e => {
              const val = e.target.value;
              setSearchQuery(val);
              if (val === '') {
                updateFilters({ q: '' });
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                updateFilters({ q: searchQuery });
              }
            }}
            placeholder="Search teams by name, member, or service..."
            className="pr-8 h-8.5 text-xs placeholder:text-muted-foreground/60"
            style={{ paddingRight: '2rem' }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                updateFilters({ q: '' });
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => updateFilters({ status: 'all' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'all'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            All ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => updateFilters({ status: 'configured' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'configured'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            Configured ({configuredCount})
          </button>
          {needsLeadCount > 0 && (
            <button
              type="button"
              onClick={() => updateFilters({ status: 'needs-lead' })}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                currentStatus === 'needs-lead'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              Needs lead ({needsLeadCount})
            </button>
          )}
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
        </div>
      </div>

      {/* Grid or Filtered Empty State */}
      {teams.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6 text-muted-foreground/60" />}
          title="No matching teams"
          description={
            currentSearch
              ? `No teams matched "${currentSearch}". Try searching with a different term.`
              : 'No teams match the selected filter.'
          }
          action={
            currentSearch || currentStatus !== 'all' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  updateFilters({ q: '', status: 'all' });
                }}
                className="text-xs h-8"
              >
                Reset filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {teams.map(team => (
            <TeamDirectoryCard key={team.id} team={team} />
          ))}
        </div>
      )}

      {pagination && (
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
