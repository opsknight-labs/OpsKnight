'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Prisma, RunbookInput } from '@prisma/client';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import {
  Activity,
  AlertCircle,
  Archive,
  BookOpen,
  Filter,
  Hand,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import { EmptyHint, SearchField, Segmented, StatTile } from '@/components/runbooks/ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
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
  { value: 'ALL', label: 'All' },
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
  const [searchQuery, setSearchQuery] = useState(rulesSearch);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('ALL');

  const filteredBindings = useMemo(() => {
    // The server already applied rulesSearch; only filter locally while the user is typing.
    const q = searchQuery.trim() === rulesSearch.trim() ? '' : searchQuery.trim().toLowerCase();
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
  }, [bindings, modeFilter, searchQuery, rulesSearch, availableAgents]);

  const countMode = (mode: Exclude<ModeFilter, 'ALL'>) =>
    bindings.filter(b => b.enabled && b.mode === mode).length;
  const pageHint = pagination ? 'This page' : undefined;
  const stats = [
    {
      label: 'Attached',
      value: bindings.length,
      icon: Workflow,
      tone: 'brand' as const,
      hint: pagination ? 'This page' : 'Active rules',
    },
    {
      label: 'Automatic',
      value: countMode('AUTOMATIC'),
      icon: Zap,
      tone: 'brand' as const,
      hint: pageHint ?? 'Runs on trigger',
    },
    {
      label: 'Suggested',
      value: countMode('SUGGESTED'),
      icon: Sparkles,
      tone: 'warning' as const,
      hint: pageHint ?? 'Offered on incidents',
    },
    {
      label: 'Manual',
      value: countMode('MANUAL'),
      icon: Hand,
      tone: 'info' as const,
      hint: pageHint ?? 'Run on demand',
    },
    {
      label: 'Executions',
      value: bindings.reduce(
        (sum, b) => sum + (b._count?.executions ?? b.executions?.length ?? 0),
        0
      ),
      icon: Activity,
      tone: 'neutral' as const,
      hint: pageHint ?? 'All time',
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
      <div className="flex flex-col items-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
        </span>
        <h3 className="text-sm font-semibold text-foreground">Service runbooks unavailable</h3>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Attached workflows could not be retrieved. Refresh to retry; the cause has been recorded
          in server logs.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  const archived = rulesState === 'archived';

  return (
    <div className="space-y-6">
      {loadErrors.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-amber-500/10 p-4 text-sm ring-1 ring-inset ring-amber-500/30"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-1">
              {loadErrors.includes('agents') && (
                <p>Agent inventory unavailable. Existing workflows remain visible.</p>
              )}
              {loadErrors.includes('pools') && <p>Pool inventory unavailable.</p>}
              {loadErrors.includes('library') && <p>Runbook library unavailable.</p>}
              <p className="text-xs text-muted-foreground">
                Configuration changes are paused until these dependencies can be checked.
              </p>
            </div>
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
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Service automations
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Rules attach library runbooks to this service: which version runs, where, with what
            inputs, and what starts it. Automatic rules save paused until checks pass.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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

      {canManage && (
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-3"
          aria-label="Search rule configuration options"
        >
          <input type="hidden" name="tab" value="runbooks" />
          <input type="hidden" name="rulesState" value={rulesState} />
          <input type="hidden" name="rulesSearch" value={rulesSearch} />
          <p className="flex basis-full items-center gap-1.5 text-xs font-medium text-muted-foreground md:basis-auto">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Narrow create-rule options
            <span className="sr-only">
              {' '}
              (up to 50 workflows, 20 versions each and 100 targets are offered)
            </span>
          </p>
          <label htmlFor={`${ids}-catalog`} className="sr-only">
            Workflow search
          </label>
          <Input
            id={`${ids}-catalog`}
            name="ruleCatalog"
            defaultValue={catalogQuery}
            maxLength={100}
            placeholder="Workflow name"
            className="h-8 min-w-36 flex-1 text-xs"
          />
          <label htmlFor={`${ids}-targets`} className="sr-only">
            Agent / pool search
          </label>
          <Input
            id={`${ids}-targets`}
            name="ruleTargets"
            defaultValue={targetQuery}
            maxLength={100}
            placeholder="Agent or pool name"
            className="h-8 min-w-36 flex-1 text-xs"
          />
          <Button type="submit" variant="secondary" size="sm" className="h-8 text-xs">
            Search options
          </Button>
        </form>
      )}

      {bindings.length > 0 && !archived && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map(stat => (
            <StatTile
              key={stat.label}
              label={stat.label}
              value={stat.value}
              icon={stat.icon}
              tone={stat.tone}
              hint={stat.hint}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          method="get"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          aria-label="Search service rule history"
        >
          <input type="hidden" name="tab" value="runbooks" />
          <select
            id={`${ids}-state`}
            name="rulesState"
            aria-label="Rule history"
            defaultValue={rulesState}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="active">Attached rules</option>
            <option value="archived">Archived rules</option>
          </select>
          <SearchField
            name="rulesSearch"
            aria-label="Search rules"
            placeholder="Search rules, runbooks or Agents…"
            value={searchQuery}
            maxLength={100}
            onChange={event => setSearchQuery(event.target.value)}
            className="min-w-48 flex-1 sm:max-w-sm"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-9"
            aria-label="Search rule history"
          >
            Search
          </Button>
        </form>
        {bindings.length > 2 && !archived && (
          <Segmented
            label="Filter by mode"
            value={modeFilter}
            onChange={setModeFilter}
            className="max-w-full self-start overflow-x-auto lg:self-auto"
            options={MODE_FILTERS.map(mode => ({
              value: mode.value,
              label: mode.label,
              count:
                mode.value === 'ALL'
                  ? bindings.length
                  : bindings.filter(binding => binding.mode === mode.value).length,
            }))}
          />
        )}
      </div>

      {bindings.length > 0 && !archived && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            {filteredBindings.length === bindings.length
              ? `${bindings.length} ${bindings.length === 1 ? 'rule' : 'rules'}`
              : `${filteredBindings.length} of ${bindings.length} rules`}{' '}
            · Readiness is checked on demand to keep this page fast.
          </p>
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
            <Link
              href={`/services/${serviceId}?${query({ rulesCheck: '1', rulesAfter: pagination?.after ?? '' })}`}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Check visible rule readiness
            </Link>
          </Button>
        </div>
      )}

      {filteredBindings.length > 0 && (
        <div className="space-y-3">
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
      )}

      {bindings.length === 0 && (
        <EmptyHint
          icon={archived ? Archive : BookOpen}
          title={
            archived
              ? 'No archived rules'
              : rulesSearch
                ? 'No rules match your search'
                : 'No service runbooks'
          }
          description={
            archived
              ? 'Detached rules appear here with their retained evidence.'
              : rulesSearch
                ? 'Try a different name, or clear the search to see every attached rule.'
                : canManage
                  ? 'Use Create rule to attach a published workflow with this service’s inputs and target.'
                  : 'No published workflows are attached to this service yet.'
          }
          className="bg-card/40"
        />
      )}

      {bindings.length > 0 && filteredBindings.length === 0 && (
        <EmptyHint
          icon={Filter}
          title="No matching rules"
          description="No rules on this page match your search or mode."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery(rulesSearch);
                setModeFilter('ALL');
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}

      {pagination && (pagination.after || pagination.hasNext) && (
        <nav
          aria-label="Automation rule pages"
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm"
        >
          <span className="text-muted-foreground tabular-nums">
            {bindings.length} rules on this page
          </span>
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
