'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { AlertTriangle, ArrowRight, CheckCircle2, SearchX, Server, Users } from 'lucide-react';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryGuideSteps,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  EmptyState,
  FilterBar,
  FilterChip,
  toneClasses,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns';
import { cn } from '@/lib/utils';
import Pagination from '@/components/service/Pagination';
import TeamDirectoryCard, { TeamLead, plural } from './TeamDirectoryCard';
import TeamAvatarStack from './TeamAvatarStack';

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

const GUIDE_STEPS = [
  {
    title: 'Assign Team Lead',
    description: 'Designate an owner/lead to receive targeted escalation notifications.',
  },
  {
    title: 'Build Responder Roster',
    description:
      'Add engineers with explicit roles (Owner, Admin, Member) and channel preferences.',
  },
  {
    title: 'Connect Owned Services',
    description: 'Link microservices and applications to automatically route incident alerts.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'All Responders',
    href: '/users',
    icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Service Catalog',
    href: '/services',
    icon: <Server className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

function ServicesSummary({ team }: { team: TeamItem }) {
  const [first, ...rest] = team.services;
  if (!first) return <span className="text-xs text-muted-foreground">No services</span>;
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="shrink-0">{plural(team._count.services, 'service')}:</span>
      <Link
        href={`/services/${first.id}`}
        className="min-w-0 truncate font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {first.name}
      </Link>
      {rest.length > 0 && (
        <span className="shrink-0" title={rest.map(service => service.name).join(', ')}>
          +{team._count.services - 1}
        </span>
      )}
    </span>
  );
}

const columns: DirectoryColumn<TeamItem>[] = [
  {
    id: 'team',
    header: 'Team',
    className: 'w-[32%] max-w-0',
    cell: team => (
      <DirectoryPrimaryCell
        href={`/teams/${team.id}`}
        title={team.name}
        subtitle={team.description || 'No description'}
        leading={
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Users className="h-4 w-4" aria-hidden="true" />
          </span>
        }
      />
    ),
  },
  {
    id: 'lead',
    hideable: true,
    header: 'Lead',
    className: 'w-[20%] max-w-0',
    cell: team => <TeamLead lead={team.teamLead} />,
  },
  {
    id: 'members',
    hideable: true,
    header: 'Members',
    className: 'w-[18%]',
    cell: team =>
      team.members.length > 0 ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <TeamAvatarStack members={team.members} maxVisible={4} size="sm" />
          <span className="tabular-nums">{team._count.members}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">No members</span>
      ),
  },
  {
    id: 'services',
    hideable: true,
    header: 'Services',
    className: 'max-w-0',
    cell: team => <ServicesSummary team={team} />,
  },
];

function mobileRow(team: TeamItem) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-2">
        <Link
          href={`/teams/${team.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {team.name}
        </Link>
        <TeamLead lead={team.teamLead} className="max-w-[45%]" />
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {plural(team._count.members, 'member')} · {plural(team._count.services, 'service')}
        {team.services[0] && `: ${team.services[0].name}`}
        {team._count.services > 1 && ` +${team._count.services - 1}`}
      </p>
    </div>
  );
}

function manageAction(team: TeamItem) {
  return (
    <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs">
      <Link href={`/teams/${team.id}`} aria-label={`Manage ${team.name}`}>
        <span className="max-sm:sr-only">Manage</span>{' '}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </Button>
  );
}

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
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useDirectoryView('teams');
  const columnVisibility = useDirectoryColumns('teams', columns);

  const updateFilters = (newParams: { q?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newParams.q !== undefined) {
      // Keep the raw text so a trailing space survives the debounce; the page trims it.
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
      router.push(qs ? `/teams?${qs}` : '/teams');
    });
  };

  const toggleStatus = (value: string) =>
    updateFilters({ status: currentStatus === value ? 'all' : value });
  const clearFilters = () => updateFilters({ q: '', status: 'all' });

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? teams.length;
  const configuredCount = filterCounts?.configured ?? 0;
  const needsLeadCount = filterCounts?.needsLead ?? 0;
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));
  const shownTotal = pagination?.totalItems ?? teams.length;
  const from =
    shownTotal === 0
      ? 0
      : pagination
        ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1
        : 1;
  const to = pagination
    ? Math.min(pagination.currentPage * pagination.itemsPerPage, shownTotal)
    : shownTotal;

  // Zero-teams total onboarding empty state (only when there are no teams at all across the tenant)
  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <EmptyState
        icon={<Users />}
        title="Welcome to Teams"
        description={
          <div className="space-y-4">
            <p>
              Teams group engineers, define incident escalation hierarchies, and attach service
              ownership. Create your first team above to get started.
            </p>
            <DirectoryGuideSteps steps={GUIDE_STEPS} className="mx-auto max-w-sm" />
          </div>
        }
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-3">
      <FilterBar
        search={{
          value: searchParams.get('q') ?? currentSearch,
          onChange: value => updateFilters({ q: value }),
          placeholder: 'Search teams by name, member, or service…',
          label: 'Search teams',
          debounceMs: 300,
        }}
        chips={
          <>
            <FilterChip
              active={currentStatus === 'all'}
              onClick={() => updateFilters({ status: 'all' })}
              count={totalCount}
            >
              All
            </FilterChip>
            <FilterChip
              tone="ok"
              icon={<CheckCircle2 />}
              active={currentStatus === 'configured'}
              onClick={() => toggleStatus('configured')}
              count={configuredCount}
            >
              Configured
            </FilterChip>
            <FilterChip
              tone="elevated"
              icon={<AlertTriangle />}
              active={currentStatus === 'needs-lead'}
              onClick={() => toggleStatus('needs-lead')}
              count={needsLeadCount}
            >
              Needs lead
            </FilterChip>
          </>
        }
        hasActiveFilters={hasActiveFilter}
        onClearAll={clearFilters}
      />

      {needsLeadCount > 0 && currentStatus !== 'needs-lead' && (
        <div
          role="status"
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-sm',
            toneClasses('elevated').soft
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-[14rem] flex-1">
            {needsLeadCount === 1 ? '1 team has' : `${needsLeadCount} teams have`} no lead, so
            {needsLeadCount === 1 ? ' its' : ' their'} escalations can&apos;t reach an owner.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateFilters({ status: 'needs-lead' })}
            className="h-7 px-2.5 text-xs"
          >
            Show teams without a lead
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <DirectoryHeader
          title="Team directory"
          summary={`Showing ${from}–${to} of ${shownTotal}`}
          columns={columnVisibility}
          density
          view={{ value: view, onChange: setView }}
          guide={
            <DirectoryGuide title="Team setup guide" steps={GUIDE_STEPS} links={GUIDE_LINKS} />
          }
        />
        <div aria-busy={isPending} className={cn('transition-opacity', isPending && 'opacity-60')}>
          {teams.length === 0 ? (
            <EmptyState
              variant="simple"
              className="py-10"
              icon={<SearchX />}
              title="No matching teams"
              description={
                currentSearch
                  ? `No teams matched "${currentSearch}". Try a different name, member, or service.`
                  : 'No teams match the selected filter.'
              }
              action={
                hasActiveFilter ? (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : view === 'table' ? (
            <DirectoryTable
              rows={teams}
              getRowId={team => team.id}
              columns={columns}
              hiddenColumns={columnVisibility.hidden}
              label="Teams"
              rowActions={manageAction}
              mobileRow={mobileRow}
            />
          ) : (
            <DirectoryCardGrid>
              {teams.map(team => (
                <TeamDirectoryCard key={team.id} team={team} />
              ))}
            </DirectoryCardGrid>
          )}
        </div>
        {pagination && (
          <div className="border-t border-border px-4">
            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              itemsPerPage={pagination.itemsPerPage}
              itemLabel="team"
            />
          </div>
        )}
      </div>
    </div>
  );
}
