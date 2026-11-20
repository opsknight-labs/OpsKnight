'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';
import {
  X,
  ShieldAlert,
  Layers,
  Loader2,
  AlertTriangle,
  Calendar,
  Server,
  Users,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryGuideSteps,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  RelativeTime,
  toneClasses,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns';
import PolicyDirectoryCard, {
  PolicyActionsMenu,
  StepTargetIcon,
  policyStepChain,
  stepTargetName,
  type PolicyDirectoryItem,
} from './PolicyDirectoryCard';
import Pagination from '@/components/service/Pagination';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const policyCount = (n: number) => (n === 1 ? '1 policy' : `${n} policies`);

const POLICY_COLUMNS: DirectoryColumn<PolicyDirectoryItem>[] = [
  {
    id: 'policy',
    header: 'Policy',
    // max-w-0 + w-full: take the spare width and truncate instead of pushing columns off-screen.
    className: 'w-full max-w-0',
    cell: policy => (
      <DirectoryPrimaryCell
        href={`/policies/${policy.id}`}
        title={policy.name}
        subtitle={policy.description || <span className="italic">No description provided</span>}
      />
    ),
  },
  {
    id: 'team',
    hideable: true,
    header: 'Teams notified',
    className: 'hidden w-36 lg:table-cell',
    cell: policy => {
      const teams = [
        ...new Map(
          policy.steps.flatMap(s => (s.targetTeam ? [[s.targetTeam.id, s.targetTeam]] : []))
        ).values(),
      ];
      if (teams.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <span
          className="block max-w-36 truncate text-xs text-foreground"
          title={teams.map(t => t.name).join(', ')}
        >
          {teams[0].name}
          {teams.length > 1 && <span className="text-muted-foreground"> +{teams.length - 1}</span>}
        </span>
      );
    },
  },
  {
    id: 'steps',
    hideable: true,
    header: 'Steps',
    className: 'w-48',
    cell: policy => {
      if (policy.stepCount === 0) {
        return (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            Needs setup · no steps
          </span>
        );
      }
      const first = policy.steps[0];
      // Delays are relative to the previous step, so the first escalation is step 2's delay.
      const firstEscalation = policy.steps[1]?.delayMinutes ?? 0;
      return (
        <div className="max-w-48 text-xs" title={policyStepChain(policy)}>
          <span className="font-medium text-foreground tabular-nums">
            {plural(policy.stepCount, 'step')}
            {policy.stepCount > 1 && (
              <span className="font-normal text-muted-foreground">
                {' '}
                · escalates in {firstEscalation}m
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
            <StepTargetIcon targetType={first.targetType} />
            <span className="truncate">Notify {stepTargetName(first, 0)}</span>
          </span>
        </div>
      );
    },
  },
  {
    id: 'services',
    hideable: true,
    header: 'Services',
    className: 'hidden w-36 md:table-cell',
    cell: policy =>
      policy.serviceCount === 0 ? (
        <span className="text-xs text-muted-foreground">Unassigned</span>
      ) : (
        <div className="max-w-36 text-xs" title={policy.services.map(s => s.name).join(', ')}>
          <span className="font-medium text-foreground tabular-nums">{policy.serviceCount}</span>
          <Link
            href={`/services/${policy.services[0].id}`}
            className="block truncate text-muted-foreground hover:text-primary hover:underline"
          >
            {policy.services[0].name}
            {policy.serviceCount > 1 && ` +${policy.serviceCount - 1}`}
          </Link>
        </div>
      ),
  },
  {
    id: 'updated',
    hideable: true,
    header: 'Updated',
    className: 'hidden w-24 xl:table-cell',
    cell: policy => (
      <RelativeTime date={policy.updatedAt} className="text-xs text-muted-foreground" />
    ),
  },
];

const GUIDE_STEPS = [
  {
    title: 'Tier 1',
    description:
      'Start with on-call schedules or primary on-call responders with a 0m initial delay.',
  },
  {
    title: 'Tier 2',
    description: 'Escalate to backup engineers or team leads after 5–10 minutes if unacknowledged.',
  },
  {
    title: 'Tier 3',
    description:
      'Route to entire escalation teams or engineering directors after 15–30 minutes for critical outages.',
  },
];

const GUIDE_LINKS = [
  {
    href: '/services',
    label: 'Services Directory',
    icon: <Server className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    href: '/schedules',
    label: 'On-Call Schedules',
    icon: <Calendar className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    href: '/teams',
    label: 'Teams & Members',
    icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

type PolicyDirectoryListProps = {
  policies: PolicyDirectoryItem[];
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
    needsSetup?: number;
  };
  currentSearch?: string;
  currentStatus?: string;
};

export default function PolicyDirectoryList({
  policies,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
}: PolicyDirectoryListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(currentSearch);
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useDirectoryView('policies');
  const columnVisibility = useDirectoryColumns('policies', POLICY_COLUMNS);
  const rangeStart = pagination ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1 : 1;

  const [syncedSearch, setSyncedSearch] = useState(currentSearch);
  if (syncedSearch !== currentSearch) {
    setSyncedSearch(currentSearch);
    setSearchQuery(currentSearch);
  }

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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchQuery });
  };

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? policies.length;
  const inUseCount = filterCounts?.inUse ?? 0;
  const unassignedCount = filterCounts?.unassigned ?? 0;
  const needsSetupCount = filterCounts?.needsSetup ?? 0;
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));

  if (totalCount === 0 && !hasActiveFilter) {
    return (
      <Card className="border-dashed border-2 bg-gradient-to-br from-ink-50/50 via-card to-ink-50/30">
        <CardContent className="p-8 md:p-12 text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-xs">
            <ShieldAlert className="h-7 w-7" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-foreground">No Escalation Policies Configured</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Escalation policies ensure incident alerts are routed to the right engineers or teams
              and automatically escalated if unacknowledged.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto text-left pt-2">
            <div className="p-3.5 rounded-xl border border-ink-200/80 bg-card shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold">
                  1
                </span>
                <span>Create Policy</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Define the policy name and repeat cadence.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-ink-200/80 bg-card shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold">
                  2
                </span>
                <span>Add Steps</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Target users, teams, or on-call schedules with minute delays.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-ink-200/80 bg-card shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold">
                  3
                </span>
                <span>Attach Services</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Link critical services to trigger routing on alert creation.
              </p>
            </div>
          </div>
          <div className="mx-auto max-w-xl border-t border-border pt-4 text-left">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              How escalation works
            </p>
            <DirectoryGuideSteps steps={GUIDE_STEPS} links={GUIDE_LINKS} />
          </div>
        </CardContent>
      </Card>
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
            placeholder="Search policies by name, description, or service..."
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
            onClick={() => updateFilters({ status: 'in-use' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'in-use'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            In Use ({inUseCount})
          </button>
          <button
            type="button"
            onClick={() => updateFilters({ status: 'unassigned' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'unassigned'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            Unassigned ({unassignedCount})
          </button>
          {needsSetupCount > 0 && (
            <button
              type="button"
              onClick={() => updateFilters({ status: 'needs-setup' })}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                currentStatus === 'needs-setup'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Needs setup ({needsSetupCount})
            </button>
          )}
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
        </div>
      </div>

      {(needsSetupCount > 0 || unassignedCount > 0) &&
        currentStatus !== 'needs-setup' &&
        currentStatus !== 'unassigned' && (
          <div
            role="status"
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-sm',
              toneClasses('elevated').soft
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="min-w-[14rem] flex-1">
              {[
                needsSetupCount > 0 &&
                  `${policyCount(needsSetupCount)} ${needsSetupCount === 1 ? 'has' : 'have'} no steps, so nobody gets paged`,
                unassignedCount > 0 &&
                  `${policyCount(unassignedCount)} ${unassignedCount === 1 ? 'is' : 'are'} not used by any service`,
              ]
                .filter(Boolean)
                .join('; ')}
              .
            </p>
            {needsSetupCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateFilters({ status: 'needs-setup' })}
                className="h-7 px-2.5 text-xs"
              >
                Show policies needing setup
              </Button>
            )}
            {unassignedCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateFilters({ status: 'unassigned' })}
                className="h-7 px-2.5 text-xs"
              >
                Show unassigned
              </Button>
            )}
          </div>
        )}

      <div className="overflow-clip rounded-lg border border-border bg-card">
        <DirectoryHeader
          title="Escalation policies"
          summary={
            policies.length > 0
              ? `Showing ${rangeStart}–${rangeStart + policies.length - 1} of ${pagination?.totalItems ?? policies.length}`
              : 'No matching policies'
          }
          columns={columnVisibility}
          density
          view={{ value: view, onChange: setView }}
          guide={
            <DirectoryGuide title="How escalation works" steps={GUIDE_STEPS} links={GUIDE_LINKS} />
          }
        />
        {policies.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-6 w-6 text-muted-foreground/60" />}
            title="No matching escalation policies"
            description={
              currentSearch
                ? `No escalation policies matched "${currentSearch}". Try a different search term.`
                : 'No escalation policies match the selected filter.'
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
                  Reset Filters
                </Button>
              ) : undefined
            }
          />
        ) : view === 'cards' ? (
          <DirectoryCardGrid className="md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
            {policies.map(policy => (
              <PolicyDirectoryCard key={policy.id} policy={policy} />
            ))}
          </DirectoryCardGrid>
        ) : (
          <DirectoryTable
            label="Escalation policies"
            rows={policies}
            getRowId={policy => policy.id}
            columns={POLICY_COLUMNS}
            hiddenColumns={columnVisibility.hidden}
            rowActions={policy => <PolicyActionsMenu policy={policy} />}
            mobileRow={policy => (
              <DirectoryPrimaryCell
                href={`/policies/${policy.id}`}
                title={policy.name}
                subtitle={`${plural(policy.stepCount, 'step')} · ${plural(policy.serviceCount, 'service')}`}
              />
            )}
          />
        )}
        {pagination && pagination.totalPages > 1 && (
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            itemsPerPage={pagination.itemsPerPage}
            itemLabel="policy"
          />
        )}
      </div>
    </div>
  );
}
