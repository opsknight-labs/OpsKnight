'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ScheduleCard from '@/components/ScheduleCard';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { X, Calendar, Loader2 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/service/Pagination';

type ScheduleItem = {
  id: string;
  name: string;
  timeZone: string;
  layers: Array<{
    users: Array<{
      userId: string;
      user?: {
        name: string;
        avatarUrl?: string | null;
        gender?: string | null;
      } | null;
    }>;
  }>;
};

type ScheduleDirectoryListProps = {
  schedules: ScheduleItem[];
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  filterCounts?: {
    total: number;
    configured: number;
    needsSetup: number;
  };
  currentSearch?: string;
  currentStatus?: string;
};

export default function ScheduleDirectoryList({
  schedules,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
}: ScheduleDirectoryListProps) {
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
      router.push(qs ? `/schedules?${qs}` : '/schedules');
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchQuery });
  };

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? schedules.length;
  const configuredCount = filterCounts?.configured ?? 0;
  const needsSetupCount = filterCounts?.needsSetup ?? 0;
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));

  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <EmptyState
        icon={<Calendar className="h-6 w-6 text-primary" />}
        title="Welcome to Schedules"
        description="On-call schedules define rotation shifts, layers, and responders. Create your first schedule above to get started."
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Search bar */}
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
            placeholder="Search schedules by name, responder, or timezone..."
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

        {/* Status filter chips */}
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
          {needsSetupCount > 0 && (
            <button
              type="button"
              onClick={() => updateFilters({ status: 'needs-setup' })}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                currentStatus === 'needs-setup'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              Needs setup ({needsSetupCount})
            </button>
          )}
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
        </div>
      </div>

      {/* Grid or Empty Search State */}
      {schedules.length === 0 ? (
        <EmptyState
          icon={<Calendar className="h-6 w-6 text-muted-foreground/60" />}
          title="No matching schedules"
          description={
            currentSearch
              ? `No schedules matched "${currentSearch}". Try a different search term.`
              : 'No schedules match the selected filter.'
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
        <div className="grid gap-3 sm:grid-cols-2">
          {schedules.map((schedule, index) => (
            <ScheduleCard key={schedule.id} schedule={schedule} index={index} />
          ))}
        </div>
      )}

      {pagination && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
          itemLabel="schedule"
        />
      )}
    </div>
  );
}
