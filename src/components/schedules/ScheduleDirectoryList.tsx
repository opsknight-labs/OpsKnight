'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import ScheduleCard, {
  ScheduleResponderStack,
  scheduleResponders,
} from '@/components/ScheduleCard';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import UserAvatar from '@/components/UserAvatar';
import { Calendar, CheckCircle2, AlertTriangle, Loader2, Network, Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/service/Pagination';
import type { OpsInsightCount } from '@/lib/intelligence/ops-insights/contract';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryGuideSteps,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  FilterBar,
  FilterChip,
  RelativeTime,
  toneClasses,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns';
import type { ScheduleOnCallSummary, ScheduleResponder } from './schedule-oncall-summary';

export type ScheduleItem = {
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
} & Partial<ScheduleOnCallSummary>;

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
  /** Open operations insights per schedule id; schedules without any are absent. */
  insightCounts?: Record<string, OpsInsightCount>;
};

function Responder({ responder }: { responder: ScheduleResponder }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar
        userId={responder.userId}
        avatarUrl={responder.avatarUrl}
        name={responder.name}
        gender={responder.gender}
        size="xs"
        aria-hidden
      />
      <span className="truncate">{responder.name}</span>
    </span>
  );
}

function NeedsSetupBadge() {
  return (
    <Badge variant="warning" size="xs">
      Needs setup
    </Badge>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const columns: DirectoryColumn<ScheduleItem>[] = [
  {
    id: 'schedule',
    header: 'Schedule',
    className: 'w-[28%]',
    cell: s => (
      <DirectoryPrimaryCell
        href={`/schedules/${s.id}`}
        title={s.name}
        subtitle={plural(scheduleResponders(s).length, 'responder')}
        leading={
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Calendar className="h-4 w-4" aria-hidden="true" />
          </span>
        }
      />
    ),
  },
  {
    id: 'oncall',
    hideable: true,
    header: 'On call now',
    cell: s =>
      s.onCallNow ? (
        <Responder responder={s.onCallNow} />
      ) : scheduleResponders(s).length === 0 ? (
        <NeedsSetupBadge />
      ) : (
        <span className="text-muted-foreground">No one</span>
      ),
  },
  {
    id: 'next',
    hideable: true,
    header: 'Next',
    className: 'hidden md:table-cell',
    cell: s =>
      s.next ? (
        <span className="flex min-w-0 flex-col">
          <Responder responder={s.next} />
          <RelativeTime
            date={s.next.start}
            format="long"
            className="pl-8 text-xs text-muted-foreground"
          />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'rotation',
    hideable: true,
    header: 'Rotation',
    className: 'hidden lg:table-cell',
    cell: s => (
      <span className="flex items-center gap-2.5">
        <span className="tabular-nums">{plural(s.layers.length, 'layer')}</span>
        <ScheduleResponderStack schedule={s} />
      </span>
    ),
  },
  {
    id: 'timezone',
    hideable: true,
    header: 'Timezone',
    className: 'hidden md:table-cell',
    cell: s => <span className="text-muted-foreground">{s.timeZone}</span>,
  },
];

function mobileRow(s: ScheduleItem) {
  return (
    <div className="min-w-0 space-y-1">
      <Link
        href={`/schedules/${s.id}`}
        className="block truncate font-medium text-foreground hover:underline"
      >
        {s.name}
      </Link>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {s.onCallNow ? (
          <Responder responder={s.onCallNow} />
        ) : scheduleResponders(s).length === 0 ? (
          <NeedsSetupBadge />
        ) : (
          <span>No one on call</span>
        )}
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{plural(s.layers.length, 'layer')}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{s.timeZone}</span>
      </div>
      {s.next && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">Next:</span>
          <Responder responder={s.next} />
          <span aria-hidden="true">·</span>
          <RelativeTime date={s.next.start} format="long" className="shrink-0" />
        </div>
      )}
    </div>
  );
}

const GUIDE_STEPS = [
  {
    title: 'Rotation Layers',
    description: 'Configure shift lengths (12h, 24h, weekly) and rotation start times.',
  },
  {
    title: 'Assign Responders',
    description: 'Add team members in rotation sequence with easy reordering.',
  },
  {
    title: 'Link Escalation Policies',
    description: 'Attach schedules to policy levels to route alerts to active on-call engineers.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'Escalation Policies',
    href: '/policies',
    icon: <Network className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Team Directory',
    href: '/teams',
    icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

export default function ScheduleDirectoryList({
  schedules,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
  insightCounts,
}: ScheduleDirectoryListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useDirectoryView('schedules');
  const columnVisibility = useDirectoryColumns('schedules', columns);

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
    if (qs === searchParams.toString()) return;
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
        icon={<Calendar className="h-6 w-6 text-primary" />}
        title="Welcome to Schedules"
        description="On-call schedules define rotation shifts, layers, and responders. Create your first schedule above to get started."
        size="lg"
        action={
          <DirectoryGuideSteps
            steps={GUIDE_STEPS}
            links={GUIDE_LINKS}
            className="mx-auto max-w-sm"
          />
        }
      />
    );
  }

  const shownTotal = pagination?.totalItems ?? schedules.length;
  const from =
    pagination && shownTotal > 0
      ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1
      : shownTotal > 0
        ? 1
        : 0;
  const to = pagination
    ? Math.min(pagination.currentPage * pagination.itemsPerPage, shownTotal)
    : schedules.length;

  const resetFilters = () => updateFilters({ q: '', status: 'all' });

  const empty = (
    <EmptyState
      icon={<Calendar className="h-6 w-6 text-muted-foreground/60" />}
      title="No matching schedules"
      description={
        currentSearch
          ? `No schedules matched "${currentSearch}". Try a different search term.`
          : 'No schedules match the selected filter.'
      }
      action={
        hasActiveFilter ? (
          <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
            Reset filters
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-3.5">
      <FilterBar
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
              tone="ok"
              icon={<CheckCircle2 />}
              active={currentStatus === 'configured'}
              count={configuredCount}
              onClick={() => updateFilters({ status: 'configured' })}
            >
              Configured
            </FilterChip>
            {needsSetupCount > 0 && (
              <FilterChip
                tone="elevated"
                icon={<AlertTriangle />}
                active={currentStatus === 'needs-setup'}
                count={needsSetupCount}
                onClick={() => updateFilters({ status: 'needs-setup' })}
              >
                Needs setup
              </FilterChip>
            )}
          </>
        }
        search={{
          value: currentSearch,
          onChange: value => updateFilters({ q: value }),
          placeholder: 'Search schedules by name, responder, or timezone…',
          label: 'Search schedules',
          debounceMs: 300,
        }}
        hasActiveFilters={hasActiveFilter}
        onClearAll={resetFilters}
        actions={
          isPending ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
              aria-label="Updating schedules"
            />
          ) : undefined
        }
      />

      {needsSetupCount > 0 && currentStatus !== 'needs-setup' && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm',
            toneClasses('elevated').soft
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {needsSetupCount === 1
              ? '1 schedule needs setup: it has no responders.'
              : `${needsSetupCount} schedules need setup: they have no responders.`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 bg-background text-xs"
            onClick={() => updateFilters({ status: 'needs-setup' })}
          >
            Show schedules needing setup
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <DirectoryHeader
          title="Schedule directory"
          summary={`Showing ${from}–${to} of ${shownTotal}`}
          columns={columnVisibility}
          density
          view={{ value: view, onChange: setView }}
          guide={
            <DirectoryGuide title="How schedules work" steps={GUIDE_STEPS} links={GUIDE_LINKS} />
          }
        />
        {schedules.length === 0 ? (
          empty
        ) : view === 'table' ? (
          <DirectoryTable
            rows={schedules}
            getRowId={s => s.id}
            columns={columns}
            hiddenColumns={columnVisibility.hidden}
            label="Schedules"
            mobileRow={mobileRow}
          />
        ) : (
          <DirectoryCardGrid>
            {schedules.map(schedule => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                insights={insightCounts?.[schedule.id]}
              />
            ))}
          </DirectoryCardGrid>
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
    </div>
  );
}
