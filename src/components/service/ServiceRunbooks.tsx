'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Prisma, RunbookInput } from '@prisma/client';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import {
  AlertCircle,
  BookOpen,
  Clock,
  Filter,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
  Zap,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { cn } from '@/lib/utils';
import type {
  BindingPresentation,
  RunbookResource,
} from '@/lib/runbooks/presentation/binding-contract';
import { ArchivedRuleCard, RuleCard } from './runbooks/RuleCard';
import { CreateRuleSheet } from './runbooks/CreateRuleSheet';

export type ServiceRunbookBinding = Prisma.ServiceAutomationRuleGetPayload<{
  include: {
    runbook: { include: { publishedVersion: { include: { inputs: true } } } };
    runbookVersion: { include: { inputs: true } };
    triggers: { include: { conditions: true } };
  };
}> & {
  presentation?: BindingPresentation;
  readiness?: BindingReadiness;
  executions?: Array<{
    id: string;
    status: string;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    createdAt: Date | string;
  }>;
  _count?: {
    executions?: number;
  };
};

type CatalogVersion = {
  id: string;
  version: number;
  state: import('@prisma/client').RunbookVersionState;
  inputs?: RunbookInput[];
  definition?: unknown;
  hasAgentWrite?: boolean;
  metadataOnly?: boolean;
};
export type AvailableRunbook = {
  id: string;
  name: string;
  description: string;
  publishedVersionId: string | null;
  publishedVersion: CatalogVersion | null;
  versions: CatalogVersion[];
};

export type ServiceRunbookAgent = {
  id: string;
  name: string;
  hostname: string | null;
  status?: string;
};

export type ServiceRunbookAgentPool = {
  id: string;
  name: string;
  mode: string;
  _count?: { members: number };
};

type ModeFilter = 'ALL' | 'AUTOMATIC' | 'MANUAL' | 'SUGGESTED';
const MODE_FILTERS: Array<{ value: ModeFilter; label: string }> = [
  { value: 'ALL', label: 'All modes' },
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'SUGGESTED', label: 'Suggested' },
  { value: 'MANUAL', label: 'Manual' },
];

export default function ServiceRunbooks({
  serviceId,
  bindings,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
  canManage,
  loadError,
  loadErrors = [],
  pagination,
  catalogQuery = '',
  targetQuery = '',
  rulesState = 'active',
  rulesSearch = '',
}: {
  pagination?: { after?: string; nextCursor?: string; hasNext: boolean };
  catalogQuery?: string;
  targetQuery?: string;
  rulesState?: 'active' | 'archived';
  rulesSearch?: string;
  serviceId: string;
  bindings: ServiceRunbookBinding[];
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
  canManage: boolean;
  loadError?: boolean;
  loadErrors?: RunbookResource[];
}) {
  const ids = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('ALL');

  const filteredBindings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bindings.filter(binding => {
      if (modeFilter !== 'ALL' && binding.mode !== modeFilter) return false;
      if (!q) return true;
      const agent =
        availableAgents.find(a => a.id === binding.defaultAgentId)?.name?.toLowerCase() ?? '';
      return (
        `${binding.name ?? ''} ${binding.runbook?.name ?? ''}`.toLowerCase().includes(q) ||
        (binding.runbook?.description?.toLowerCase() ?? '').includes(q) ||
        agent.includes(q)
      );
    });
  }, [bindings, modeFilter, searchQuery, availableAgents]);

  const pageSuffix = pagination ? ' · This page' : '';
  const stats = [
    { label: 'Attached', value: bindings.length, icon: Workflow, tone: 'text-primary' },
    {
      label: `Automatic${pageSuffix}`,
      value: bindings.filter(b => b.enabled && b.mode === 'AUTOMATIC').length,
      icon: Zap,
      tone: 'text-indigo-500',
    },
    {
      label: `Manual${pageSuffix}`,
      value: bindings.filter(b => b.enabled && b.mode === 'MANUAL').length,
      icon: Play,
      tone: 'text-sky-500',
    },
    {
      label: `Executions${pageSuffix}`,
      value: bindings.reduce(
        (sum, b) => sum + (b._count?.executions ?? b.executions?.length ?? 0),
        0
      ),
      icon: Clock,
      tone: 'text-amber-500',
    },
  ];

  const configurationAvailable = !loadErrors.some(resource =>
    ['library', 'agents', 'pools'].includes(resource)
  );
  const query = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      tab: 'runbooks',
      rulesState,
      rulesSearch,
      ruleCatalog: catalogQuery,
      ruleTargets: targetQuery,
      ...extra,
    }).toString();

  if (loadError || loadErrors.includes('bindings')) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
        <h3 className="mt-2 text-sm font-semibold text-foreground">Service runbooks unavailable</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Attached workflows could not be retrieved. Refresh to retry; the cause has been recorded
          in server logs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadErrors.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <div className="space-y-1">
            {loadErrors.includes('agents') && (
              <p>Agent inventory unavailable. Existing workflows remain visible.</p>
            )}
            {loadErrors.includes('pools') && <p>Pool inventory unavailable.</p>}
            {loadErrors.includes('library') && <p>Runbook library unavailable.</p>}
            <p className="text-muted-foreground">
              Configuration changes are temporarily unavailable because their dependencies could not
              be checked.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry loading
          </Button>
        </div>
      )}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Service Automations
            </h2>
            <Badge variant="outline" className="px-2 py-0.5 text-xs font-semibold">
              {bindings.length} {pagination ? 'on this page' : 'attached'}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rules connect library runbooks to this service: which version runs, where it runs, with
            which inputs, and what triggers it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
            <Link href="/runbooks">
              <BookOpen className="h-4 w-4" aria-hidden />
              <span>Library</span>
            </Link>
          </Button>
          {canManage && configurationAvailable && availableRunbooks.length > 0 && (
            <CreateRuleSheet
              serviceId={serviceId}
              runbooks={availableRunbooks}
              agents={availableAgents}
              pools={availableAgentPools}
            />
          )}
        </div>
      </header>

      {bindings.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(stat => (
            <div key={stat.label} className="rounded-xl border bg-card/60 p-3.5">
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <stat.icon className={cn('h-4 w-4', stat.tone)} aria-hidden />
                {stat.label}
              </dt>
              <dd className="mt-1.5 text-2xl font-bold text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section
        aria-label="Rule filters"
        className="space-y-3 rounded-xl border bg-card/40 p-3 sm:p-4"
      >
        <form
          method="get"
          className="flex flex-wrap items-end gap-2"
          aria-label="Search service rule history"
        >
          <input type="hidden" name="tab" value="runbooks" />
          <div className="space-y-1">
            <label htmlFor={`${ids}-state`} className="text-xs font-medium text-muted-foreground">
              Rule history
            </label>
            <select
              id={`${ids}-state`}
              name="rulesState"
              aria-label="Rule history"
              defaultValue={rulesState}
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="active">Attached rules</option>
              <option value="archived">Archived rules</option>
            </select>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor={`${ids}-search`} className="text-xs font-medium text-muted-foreground">
              Search rules
            </label>
            <Input
              id={`${ids}-search`}
              name="rulesSearch"
              defaultValue={rulesSearch}
              maxLength={100}
              className="h-9"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="h-9">
            <Search className="h-3.5 w-3.5" aria-hidden />
            Search rule history
          </Button>
        </form>

        {bindings.length > 2 && (
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Filter
                className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="text"
                aria-label="Filter rules on this page"
                placeholder="Filter rules on this page…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-9 pl-9 text-xs"
              />
            </div>
            <div
              role="group"
              aria-label="Filter by mode"
              className="inline-flex rounded-lg border bg-muted/40 p-0.5"
            >
              {MODE_FILTERS.map(mode => (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={modeFilter === mode.value}
                  onClick={() => setModeFilter(mode.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    modeFilter === mode.value
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {canManage && (
          <form
            method="get"
            className="flex flex-wrap items-end gap-2 border-t pt-3"
            aria-label="Search rule configuration options"
          >
            <input type="hidden" name="tab" value="runbooks" />
            <input type="hidden" name="rulesState" value={rulesState} />
            <input type="hidden" name="rulesSearch" value={rulesSearch} />
            <div className="min-w-40 flex-1 space-y-1">
              <label
                htmlFor={`${ids}-catalog`}
                className="text-xs font-medium text-muted-foreground"
              >
                Workflow search
              </label>
              <Input
                id={`${ids}-catalog`}
                name="ruleCatalog"
                defaultValue={catalogQuery}
                maxLength={100}
                className="h-9"
              />
            </div>
            <div className="min-w-40 flex-1 space-y-1">
              <label
                htmlFor={`${ids}-targets`}
                className="text-xs font-medium text-muted-foreground"
              >
                Agent / pool search
              </label>
              <Input
                id={`${ids}-targets`}
                name="ruleTargets"
                defaultValue={targetQuery}
                maxLength={100}
                className="h-9"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-9">
              Search options
            </Button>
            <p className="basis-full text-xs text-muted-foreground">
              Narrows the workflows and targets offered when creating a rule (up to 50 workflows, 20
              versions each and 100 targets).
            </p>
          </form>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Readiness checks are on demand to keep this page fast.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/services/${serviceId}?${query({ rulesCheck: '1', rulesAfter: pagination?.after ?? '' })}`}
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Check visible rule readiness
          </Link>
        </Button>
      </div>

      <div className="space-y-4">
        {filteredBindings.map(binding =>
          binding.detachedAt ? (
            <ArchivedRuleCard key={binding.id} serviceId={serviceId} binding={binding} />
          ) : (
            <RuleCard
              key={binding.id}
              serviceId={serviceId}
              binding={binding}
              availableRunbooks={availableRunbooks}
              availableAgents={availableAgents}
              availableAgentPools={availableAgentPools}
              canManage={canManage}
              configurationAvailable={configurationAvailable}
              loadErrors={loadErrors}
            />
          )
        )}
      </div>

      {bindings.length === 0 && (
        <EmptyState
          title={rulesState === 'archived' ? 'No archived rules' : 'No service runbooks'}
          description={
            rulesState === 'archived'
              ? 'Detached rules appear here with their retained evidence.'
              : 'Attach a published workflow with this service’s inputs and execution target.'
          }
          icon={<BookOpen className="h-10 w-10 text-muted-foreground" />}
        />
      )}

      {bindings.length > 0 && filteredBindings.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Filter className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold text-foreground">No matching rules</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            No rules on this page match your filter or mode.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setModeFilter('ALL');
            }}
            className="mt-3 text-xs"
          >
            Clear filters
          </Button>
        </div>
      )}

      {pagination && (pagination.after || pagination.hasNext) && (
        <nav
          aria-label="Automation rule pages"
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm"
        >
          <span className="text-muted-foreground">{bindings.length} rules on this page</span>
          <div className="flex gap-2">
            {pagination.after && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/services/${serviceId}?${query()}`}>First rules</Link>
              </Button>
            )}
            {pagination.hasNext && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/services/${serviceId}?${query({ rulesAfter: pagination.nextCursor ?? '' })}`}
                >
                  Next rules
                </Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
