'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ScheduleCard from '@/components/ScheduleCard';
import { Button } from '@/components/ui/shadcn/button';
import { Calendar, Loader2, SearchX } from 'lucide-react';
import EmptyState from '@/components/patterns/EmptyState';
import FilterBar, { FilterChip } from '@/components/patterns/FilterBar';
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
  const [isPending, startTransition] = useTransition();

  const updateFilters = (newParams: { q?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newParams.q !== undefined) {
      // Keep the raw text: trimming here would eat the space the user is still typing.
      if (newParams.q.trim()) params.set('q', newParams.q);
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

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? schedules.length;
  const configuredCount = filterCounts?.configured ?? 0;
  const needsSetupCount = filterCounts?.needsSetup ?? 0;
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));

  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <EmptyState
        icon={<Calendar />}
        title="No schedules yet"
        description="A schedule decides who is on call and when. Create one with “New schedule”, add a rotation layer and responders, then attach it to an escalation policy."
        secondaryAction={
          <Button asChild variant="outline" size="sm">
            <Link href="/policies">Escalation policies</Link>
          </Button>
        }
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-4">
      <FilterBar
        search={{
          value: currentSearch,
          onChange: value => updateFilters({ q: value }),
          placeholder: 'Search by name, responder or time zone',
          label: 'Search schedules',
          debounceMs: 300,
        }}
        chips={
          <>
            <FilterChip
              active={currentStatus === 'all'}
              count={totalCount}
              onClick={() => updateFilters({ status: 'all' })}
            >
              All
            </FilterChip>
            <FilterChip
              active={currentStatus === 'configured'}
              count={configuredCount}
              onClick={() =>
                updateFilters({ status: currentStatus === 'configured' ? 'all' : 'configured' })
              }
            >
              Configured
            </FilterChip>
            {(needsSetupCount > 0 || currentStatus === 'needs-setup') && (
              <FilterChip
                active={currentStatus === 'needs-setup'}
                count={needsSetupCount}
                onClick={() =>
                  updateFilters({
                    status: currentStatus === 'needs-setup' ? 'all' : 'needs-setup',
                  })
                }
              >
                Needs setup
              </FilterChip>
            )}
          </>
        }
        hasActiveFilters={hasActiveFilter}
        onClearAll={() => updateFilters({ q: '', status: 'all' })}
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

      {schedules.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No schedules match these filters"
          description={
            currentSearch
              ? `Nothing matched “${currentSearch}”. Try a responder name or a time zone.`
              : 'No schedules match the selected filter.'
          }
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateFilters({ q: '', status: 'all' })}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Schedules">
          {schedules.map((schedule, index) => (
            <li key={schedule.id} className="min-w-0">
              <ScheduleCard schedule={schedule} index={index} />
            </li>
          ))}
        </ul>
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
