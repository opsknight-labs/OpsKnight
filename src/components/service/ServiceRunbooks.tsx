'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Prisma, RunbookInput } from '@prisma/client';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import {
  Activity,
  AlertCircle,
  Archive,
  BookOpen,
  ChevronDown,
  Filter,
  Hand,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { EmptyHint } from '@/components/runbooks/ui/primitives';
import type {
  BindingPresentation,
  RunbookResource,
} from '@/lib/runbooks/presentation/binding-contract';
import { ArchivedRuleCard, RuleCard } from './runbooks/RuleCard';
import { CreateRuleSheet } from './runbooks/CreateRuleSheet';
import type { AutomationContextSummary } from './runbooks/context-helpers';
import type { ServiceRunbookUnattendedWriteDetails } from './runbooks/RuleAutomationControls';
import { cn } from '@/lib/utils';

export type { ServiceRunbookUnattendedWriteDetails };

export type ServiceRunbookBinding = Prisma.ServiceAutomationRuleGetPayload<{
  include: {
    runbook: { include: { publishedVersion: { include: { inputs: true } } } };
    runbookVersion: { include: { inputs: true } };
    triggers: { include: { conditions: true } };
  };
}> & {
  presentation?: BindingPresentation;
  readiness?: BindingReadiness;
  unattendedWritesAuthorizedBy?: { name: string | null } | null;
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
  userTimeZone,
  automationContext = null,
  unattendedWriteDetails = {},
  canAuthorizeUnattendedWrites = false,
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
  userTimeZone?: string;
  automationContext?: AutomationContextSummary | null;
  unattendedWriteDetails?: ServiceRunbookUnattendedWriteDetails;
  canAuthorizeUnattendedWrites?: boolean;
}) {
  const ids = useId();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(rulesSearch);
  const [selectedState, setSelectedState] = useState(rulesState);
  const [prevRulesSearch, setPrevRulesSearch] = useState(rulesSearch);
  const [prevRulesState, setPrevRulesState] = useState(rulesState);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('ALL');
  const [showScope, setShowScope] = useState(true);

  if (rulesSearch !== prevRulesSearch) {
    setPrevRulesSearch(rulesSearch);
    setSearchQuery(rulesSearch);
  }

  if (rulesState !== prevRulesState) {
    setPrevRulesState(rulesState);
    setSelectedState(rulesState);
  }

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

  const countMode = (mode: Exclude<ModeFilter, 'ALL'>) =>
    bindings.filter(b => b.enabled && b.mode === mode).length;

  const totalExecutions = bindings.reduce(
    (sum, b) => sum + (b._count?.executions ?? b.executions?.length ?? 0),
    0
  );

  const stats = [
    {
      label: 'Attached Rules',
      value: bindings.length,
      icon: Workflow,
      color: 'text-primary bg-primary/10 border-primary/20',
      hint: pagination ? 'This page' : 'Active rules',
    },
    {
      label: 'Automatic',
      value: countMode('AUTOMATIC'),
      icon: Zap,
      color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      hint: 'Runs on trigger',
    },
    {
      label: 'Suggested',
      value: countMode('SUGGESTED'),
      icon: Sparkles,
      color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
      hint: 'Incident triage',
    },
    {
      label: 'Manual',
      value: countMode('MANUAL'),
      icon: Hand,
      color: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20',
      hint: 'On-demand run',
    },
    {
      label: 'Executions',
      value: totalExecutions,
      icon: Activity,
      color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
      hint: 'Fleet runs',
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

  const archived = rulesState === 'archived';
  const hasActiveFilters = Boolean(
    searchQuery.trim() || modeFilter !== 'ALL' || archived || catalogQuery || targetQuery
  );

  if (loadError || loadErrors.includes('bindings')) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center shadow-xs">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertCircle className="h-5 w-5" aria-hidden />
        </span>
        <h3 className="text-sm font-bold text-foreground">Service runbooks unavailable</h3>
        <p className="mt-1 max-w-md text-xs text-muted-foreground leading-relaxed">
          Attached workflows could not be retrieved from the database. Refresh to retry; telemetry
          has been logged.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5 shadow-2xs"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Retry Connection
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-4.5">
      {/* Dependency Warning if Agents or Library failed to load */}
      {loadErrors.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-100 ring-1 ring-inset ring-amber-500/30"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-0.5">
              {loadErrors.includes('agents') && (
                <p className="font-semibold">
                  Agent inventory unavailable. Existing workflows remain visible.
                </p>
              )}
              {loadErrors.includes('pools') && (
                <p className="font-semibold">Pool inventory unavailable.</p>
              )}
              {loadErrors.includes('library') && (
                <p className="font-semibold">Runbook library unavailable.</p>
              )}
              <p className="text-muted-foreground">
                Configuration edits are temporarily locked until backend dependencies recover.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {/* Top Header Section */}
      <header className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/25 shadow-2xs">
            <Workflow className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold tracking-tight text-foreground">
              Service Automations
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Attach version-controlled runbooks to automatically recover from incidents or provide
              guided remediation for on-call responders.
            </p>
          </div>
        </div>

        {/* Proper Matching Action Buttons */}
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5 rounded-lg border border-border/80 bg-background hover:bg-accent/60 text-foreground font-semibold text-xs shadow-2xs transition-all inline-flex items-center justify-center"
          >
            <Link href="/runbooks">
              <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden />
              <span>Catalog</span>
            </Link>
          </Button>
          {canManage && configurationAvailable && availableRunbooks.length > 0 && (
            <CreateRuleSheet
              serviceId={serviceId}
              runbooks={availableRunbooks}
              agents={availableAgents}
              pools={availableAgentPools}
              automationContext={automationContext}
            />
          )}
        </div>
      </header>

      {/* Modern Metric Telemetry Cards */}
      {bindings.length > 0 && !archived && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="group relative overflow-hidden rounded-xl border border-border/80 bg-card/70 backdrop-blur-xs p-2.5 sm:p-3 shadow-2xs hover:shadow-xs hover:border-border transition-all duration-150"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                    {stat.label}
                  </span>
                  <span
                    className={cn(
                      'flex h-5.5 w-5.5 items-center justify-center rounded-md border shadow-2xs shrink-0',
                      stat.color
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                  </span>
                </div>
                <div className="mt-1 text-base sm:text-lg font-bold tracking-tight text-foreground tabular-nums">
                  {stat.value}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground/80 truncate">
                  {stat.hint}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Redesigned Clean & Robust Filter Card matching LibraryFilterBar */}
      {(canManage || bindings.length > 0 || hasActiveFilters) && (
        <Card className="border border-border/80 shadow-2xs transition-colors">
          <CardHeader className="py-2.5 px-3.5 sm:px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                  <Filter className="h-3.5 w-3.5" />
                </div>
                <div>
                  <CardTitle className="text-xs sm:text-sm font-bold text-foreground">
                    Filter Rules
                  </CardTitle>
                  <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
                    Filter by execution mode, lifecycle status, or keyword
                  </CardDescription>
                </div>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
                  onClick={() => {
                    setSearchQuery('');
                    setModeFilter('ALL');
                    router.push(`/services/${serviceId}?tab=runbooks`);
                  }}
                >
                  <X className="mr-1 h-3 w-3" /> Clear filters
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-2.5 pt-0 px-3.5 sm:px-4 pb-3">
            {/* Quick Mode Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Badge
                variant={modeFilter === 'ALL' && !archived ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'cursor-pointer transition-colors shadow-2xs font-semibold py-1 px-2.5 text-xs',
                  modeFilter === 'ALL' && !archived
                    ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                    : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
                onClick={() => {
                  setModeFilter('ALL');
                  if (archived)
                    router.push(`/services/${serviceId}?tab=runbooks&rulesState=active`);
                }}
              >
                All rules ({bindings.length})
              </Badge>
              <Badge
                variant={modeFilter === 'AUTOMATIC' && !archived ? 'success' : 'outline'}
                size="sm"
                className={cn(
                  'cursor-pointer transition-colors shadow-2xs font-semibold py-1 px-2.5 text-xs',
                  modeFilter === 'AUTOMATIC' && !archived
                    ? 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700'
                    : 'bg-card border-border/80 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10'
                )}
                onClick={() => {
                  setModeFilter(modeFilter === 'AUTOMATIC' ? 'ALL' : 'AUTOMATIC');
                  if (archived)
                    router.push(`/services/${serviceId}?tab=runbooks&rulesState=active`);
                }}
              >
                <Zap className="mr-1 h-3 w-3" /> Automatic ({countMode('AUTOMATIC')})
              </Badge>
              <Badge
                variant={modeFilter === 'SUGGESTED' && !archived ? 'warning' : 'outline'}
                size="sm"
                className={cn(
                  'cursor-pointer transition-colors shadow-2xs font-semibold py-1 px-2.5 text-xs',
                  modeFilter === 'SUGGESTED' && !archived
                    ? 'bg-amber-600 text-white border-amber-600 dark:bg-amber-500 hover:bg-amber-700'
                    : 'bg-card border-border/80 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10'
                )}
                onClick={() => {
                  setModeFilter(modeFilter === 'SUGGESTED' ? 'ALL' : 'SUGGESTED');
                  if (archived)
                    router.push(`/services/${serviceId}?tab=runbooks&rulesState=active`);
                }}
              >
                <Sparkles className="mr-1 h-3 w-3" /> Suggested ({countMode('SUGGESTED')})
              </Badge>
              <Badge
                variant={modeFilter === 'MANUAL' && !archived ? 'info' : 'outline'}
                size="sm"
                className={cn(
                  'cursor-pointer transition-colors shadow-2xs font-semibold py-1 px-2.5 text-xs',
                  modeFilter === 'MANUAL' && !archived
                    ? 'bg-sky-600 text-white border-sky-600 dark:bg-sky-500 hover:bg-sky-700'
                    : 'bg-card border-border/80 text-muted-foreground hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-500/10'
                )}
                onClick={() => {
                  setModeFilter(modeFilter === 'MANUAL' ? 'ALL' : 'MANUAL');
                  if (archived)
                    router.push(`/services/${serviceId}?tab=runbooks&rulesState=active`);
                }}
              >
                <Hand className="mr-1 h-3 w-3" /> Manual ({countMode('MANUAL')})
              </Badge>
              <Badge
                variant={archived ? 'secondary' : 'outline'}
                size="sm"
                className={cn(
                  'cursor-pointer transition-colors shadow-2xs font-semibold py-1 px-2.5 text-xs',
                  archived
                    ? 'bg-slate-700 text-white border-slate-700 hover:bg-slate-800'
                    : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
                onClick={() => {
                  router.push(
                    `/services/${serviceId}?tab=runbooks&rulesState=${archived ? 'active' : 'archived'}`
                  );
                }}
              >
                <Archive className="mr-1 h-3 w-3" /> Archived
              </Badge>
            </div>

            {/* Grid Layout Inputs Row matching LibraryFilterBar */}
            <form
              method="get"
              onSubmit={e => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const state = (formData.get('rulesState') as string) || selectedState || rulesState;
                const search = (formData.get('rulesSearch') as string) ?? searchQuery;
                const params = new URLSearchParams();
                params.set('tab', 'runbooks');
                if (state) params.set('rulesState', state);
                if (search) params.set('rulesSearch', search);
                router.push(`/services/${serviceId}?${params.toString()}`);
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end pt-2 border-t border-border/60"
            >
              {/* Search Input */}
              <div
                className={cn(
                  'space-y-1',
                  canManage ? 'sm:col-span-5 lg:col-span-5' : 'sm:col-span-6 lg:col-span-6'
                )}
              >
                <Label
                  htmlFor={`${ids}-search`}
                  className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"
                >
                  <Search className="h-3 w-3" /> Search
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    id={`${ids}-search`}
                    name="rulesSearch"
                    aria-label="Search rules"
                    placeholder="Search rules by name, runbook, or target agent…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="h-9 rounded-xl pl-9 pr-8 text-xs font-medium w-full bg-background/80 shadow-2xs"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Lifecycle Dropdown */}
              <div
                className={cn(
                  'space-y-1',
                  canManage ? 'sm:col-span-3 lg:col-span-3' : 'sm:col-span-3 lg:col-span-3'
                )}
              >
                <Label
                  htmlFor={`${ids}-state`}
                  className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"
                >
                  <Activity className="h-3 w-3" /> Lifecycle
                </Label>
                <select
                  id={`${ids}-state`}
                  name="rulesState"
                  aria-label="Rule history"
                  value={selectedState}
                  onChange={e => {
                    const val = e.target.value === 'archived' ? 'archived' : 'active';
                    setSelectedState(val);
                    const params = new URLSearchParams();
                    params.set('tab', 'runbooks');
                    if (val) params.set('rulesState', val);
                    if (searchQuery) params.set('rulesSearch', searchQuery);
                    router.push(`/services/${serviceId}?${params.toString()}`);
                  }}
                  className="h-9 w-full rounded-xl border border-input/80 bg-background/80 px-2.5 text-xs font-medium shadow-2xs focus:ring-2 focus:ring-primary/40 focus:outline-none transition-colors"
                >
                  <option value="active">Attached rules</option>
                  <option value="archived">Archived rules</option>
                </select>
              </div>

              {/* Search Submit Button */}
              <div
                className={cn(
                  'space-y-1',
                  canManage ? 'sm:col-span-2 lg:col-span-2' : 'sm:col-span-3 lg:col-span-3'
                )}
              >
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full font-medium text-xs rounded-xl shadow-2xs"
                  aria-label="Search rule history"
                >
                  Search
                </Button>
              </div>

              {/* Scope Parameters Toggle Button */}
              {canManage && (
                <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <SlidersHorizontal className="h-3 w-3" /> Scope
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowScope(!showScope)}
                    className={cn(
                      'h-9 w-full justify-between rounded-xl border-input/80 bg-background/80 text-xs font-medium shadow-2xs',
                      (catalogQuery || targetQuery) &&
                        'border-primary/50 text-primary bg-primary/5',
                      showScope && 'border-primary text-primary'
                    )}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                      <span>Filter</span>
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
                        showScope && 'rotate-180'
                      )}
                    />
                  </Button>
                </div>
              )}
            </form>

            {/* Scope Inputs (only displayed when expanded) */}
            {showScope && canManage && (
              <form
                method="get"
                className="mt-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2.5 rounded-xl border border-border/70 bg-muted/20 p-3"
              >
                <input type="hidden" name="tab" value="runbooks" />
                <input type="hidden" name="rulesState" value={rulesState} />
                <input type="hidden" name="rulesSearch" value={rulesSearch} />
                <div className="sm:col-span-5 space-y-1">
                  <Label
                    htmlFor={`${ids}-catalog`}
                    className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1"
                  >
                    <BookOpen className="h-3 w-3" /> Catalog Scope
                  </Label>
                  <Input
                    id={`${ids}-catalog`}
                    name="ruleCatalog"
                    aria-label="Workflow search"
                    defaultValue={catalogQuery}
                    maxLength={100}
                    placeholder="Filter workflow creation list…"
                    className="h-8.5 text-xs rounded-lg bg-background/80"
                  />
                </div>
                <div className="sm:col-span-5 space-y-1">
                  <Label
                    htmlFor={`${ids}-targets`}
                    className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1"
                  >
                    <Workflow className="h-3 w-3" /> Target Scope
                  </Label>
                  <Input
                    id={`${ids}-targets`}
                    name="ruleTargets"
                    aria-label="Agent / pool search"
                    defaultValue={targetQuery}
                    maxLength={100}
                    placeholder="Filter target agents/pools…"
                    className="h-8.5 text-xs rounded-lg bg-background/80"
                  />
                </div>
                <div className="sm:col-span-2 flex items-end">
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    aria-label="Search options"
                    className="h-8.5 w-full text-xs font-semibold shadow-2xs"
                  >
                    Search options
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Compact Fleet Readiness Telemetry Bar */}
      {bindings.length > 0 && !archived && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs px-3.5 py-2 shadow-2xs">
          <p className="text-xs text-muted-foreground tabular-nums flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {filteredBindings.length === bindings.length
                ? `${bindings.length} ${bindings.length === 1 ? 'rule' : 'rules'}`
                : `${filteredBindings.length} of ${bindings.length} rules`}
            </span>
            <span>·</span>
            <span className="text-[11px]">
              Readiness is verified on demand to preserve low-latency page performance.
            </span>
          </p>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-7.5 gap-1.5 shadow-2xs text-xs font-semibold hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300"
          >
            <Link
              href={`/services/${serviceId}?${query({ rulesCheck: '1', rulesAfter: pagination?.after ?? '' })}`}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              <span>Verify Readiness</span>
            </Link>
          </Button>
        </div>
      )}

      {/* Rules Grid List */}
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
                userTimeZone={userTimeZone}
                automationContext={automationContext}
                unattendedWriteDetails={unattendedWriteDetails[binding.id]}
                canAuthorizeUnattendedWrites={canAuthorizeUnattendedWrites}
              />
            )
          )}
        </div>
      )}

      {/* Empty State when no rules exist */}
      {bindings.length === 0 && (
        <EmptyHint
          icon={archived ? Archive : BookOpen}
          title={
            archived
              ? 'No archived rules'
              : rulesSearch
                ? 'No rules match your search'
                : 'No service runbooks attached'
          }
          description={
            archived
              ? 'Detached automation rules appear here with their retained execution audit history.'
              : rulesSearch
                ? 'Try a different keyword, or clear the search filter to display all rules.'
                : canManage
                  ? 'Attach an automated recovery runbook from the catalog to handle incidents automatically.'
                  : 'No recovery runbooks have been attached to this service yet.'
          }
          className="bg-card/40"
        />
      )}

      {/* Empty State when filters return 0 results */}
      {bindings.length > 0 && filteredBindings.length === 0 && (
        <EmptyHint
          icon={Filter}
          title="No matching rules found"
          description="None of the attached rules match your current search query or execution mode filter."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery(rulesSearch);
                setModeFilter('ALL');
              }}
            >
              Reset Filters
            </Button>
          }
        />
      )}

      {/* Server-Side Pagination */}
      {pagination && (pagination.after || pagination.hasNext) && (
        <nav
          aria-label="Automation rule pages"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 pt-4 text-xs"
        >
          <span className="text-muted-foreground tabular-nums font-medium">
            {bindings.length} rules on this page
          </span>
          <div className="flex gap-2">
            {pagination.after && (
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                <Link href={`/services/${serviceId}?${query()}`}>First rules</Link>
              </Button>
            )}
            {pagination.hasNext && (
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
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
