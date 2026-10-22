'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { resolveEffectiveAgentStatus } from '@/lib/runbooks/presentation/contracts';
import type { RunbookAgentStatus } from '@prisma/client';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  HardDrive,
  Info,
  Search,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { formatDateTime } from '@/lib/timezone';

export type HealthDetailCardsProps = {
  localWorker: {
    running: boolean;
    lastError?: string | null;
    lastRunbookError?: string | null;
    lane: string;
    lastSuccessAt?: Date | null;
  };
  pending: number;
  oldest: number;
  artifacts: { count: number; sizeBytes: number };
  unknown: number;
  expiredLeases: number;
  circuits: number;
  deadLetters: number;
  unhealthyAgents: Array<{
    id: string;
    name: string;
    status: RunbookAgentStatus;
    lastHeartbeatAt: Date | null;
    lastError: string | null;
    spoolDepth: number;
    deadLetterDepth: number;
  }>;
  totalAgentsCount: number;
  totalUnhealthy?: number;
  now: Date;
  userTimeZone: string;
};

type AgentFilter = 'ALL' | 'OFFLINE' | 'ENROLLING' | 'ERROR';

export function HealthDetailCards({
  localWorker,
  pending,
  oldest,
  artifacts,
  unknown,
  expiredLeases,
  circuits,
  deadLetters,
  unhealthyAgents,
  totalAgentsCount,
  totalUnhealthy,
  now,
  userTimeZone,
}: HealthDetailCardsProps) {
  const [filter, setFilter] = useState<AgentFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const effectiveNow = useMemo(() => new Date(now), [now]);

  // Pre-calculate effective agent statuses
  const evaluatedAgents = useMemo(() => {
    return unhealthyAgents.map(agent => ({
      ...agent,
      effectiveStatus: resolveEffectiveAgentStatus(agent, effectiveNow),
    }));
  }, [unhealthyAgents, effectiveNow]);

  const offlineCount = useMemo(
    () => evaluatedAgents.filter(a => a.effectiveStatus === 'OFFLINE').length,
    [evaluatedAgents]
  );
  const enrollingCount = useMemo(
    () => evaluatedAgents.filter(a => a.effectiveStatus === 'ENROLLING').length,
    [evaluatedAgents]
  );
  const errorCount = useMemo(
    () => evaluatedAgents.filter(a => Boolean(a.lastError)).length,
    [evaluatedAgents]
  );

  // Filter agents based on active tab and search query
  const filteredAgents = useMemo(() => {
    return evaluatedAgents.filter(agent => {
      // Tab filter
      if (filter === 'OFFLINE' && agent.effectiveStatus !== 'OFFLINE') return false;
      if (filter === 'ENROLLING' && agent.effectiveStatus !== 'ENROLLING') return false;
      if (filter === 'ERROR' && !agent.lastError) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = agent.name.toLowerCase().includes(query);
        const matchesError = agent.lastError?.toLowerCase().includes(query);
        return matchesName || matchesError;
      }
      return true;
    });
  }, [evaluatedAgents, filter, searchQuery]);

  // Visible agents (cap at 8 when collapsed unless user expanded or filtered)
  const defaultPageSize = 8;
  const isCapped =
    !expanded && filteredAgents.length > defaultPageSize && filter === 'ALL' && !searchQuery;
  const visibleAgents = isCapped ? filteredAgents.slice(0, defaultPageSize) : filteredAgents;

  const runbookWorkerError =
    localWorker.running &&
    (localWorker.lane === 'runbook' ? localWorker.lastError : localWorker.lastRunbookError);

  const isExecutionDegraded = Boolean(runbookWorkerError);
  const isQueueDegraded = pending > 50 || oldest > 300;
  const isSafetyDegraded = unknown > 0 || expiredLeases > 0 || circuits > 0 || deadLetters > 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 3 Diagnostic Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Card 1: Execution Plane */}
        <div className="flex flex-col justify-between rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs hover:border-border transition-colors">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-foreground/80 shadow-2xs">
                  <Terminal className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="text-sm font-bold tracking-tight text-foreground truncate">
                  Execution Plane
                </h3>
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                  isExecutionDegraded
                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/25'
                    : localWorker.running
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
                      : 'bg-muted text-muted-foreground ring-border'
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isExecutionDegraded
                      ? 'bg-rose-500 animate-pulse'
                      : localWorker.running
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-muted-foreground/60'
                  )}
                />
                {isExecutionDegraded
                  ? 'Needs Attention'
                  : localWorker.running
                    ? 'Operational'
                    : 'Standby'}
              </span>
            </div>

            {/* Metrics */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-3.5 py-2">
                <span className="text-xs text-muted-foreground">Local Worker</span>
                <span
                  className={cn(
                    'text-xs font-semibold tabular-nums',
                    runbookWorkerError
                      ? 'text-destructive font-bold'
                      : localWorker.running
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                  )}
                >
                  {localWorker.running
                    ? runbookWorkerError
                      ? 'Needs attention'
                      : 'Running'
                    : 'Not observed in process'}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-3.5 py-2">
                <span className="text-xs text-muted-foreground">Worker Lane</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                  {localWorker.lane}
                </code>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-3.5 py-2">
                <span className="text-xs text-muted-foreground">Last Cycle</span>
                <span className="text-xs font-medium tabular-nums text-foreground">
                  {localWorker.lastSuccessAt
                    ? formatDateTime(localWorker.lastSuccessAt, userTimeZone, {
                        format: 'datetime',
                        includeTimeZone: true,
                      })
                    : 'Not observed'}
                </span>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-border/50 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info
              className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70"
              aria-hidden="true"
            />
            <span>
              In split deployments, web processes do not observe background runners. Monitor
              readiness endpoints independently.
            </span>
          </div>
        </div>

        {/* Card 2: Queue & Storage */}
        <div className="flex flex-col justify-between rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs hover:border-border transition-colors">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-foreground/80 shadow-2xs">
                  <HardDrive className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="text-sm font-bold tracking-tight text-foreground truncate">
                  Queue & Storage
                </h3>
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                  isQueueDegraded
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isQueueDegraded ? 'bg-amber-500' : 'bg-emerald-500'
                  )}
                />
                {isQueueDegraded ? 'Backlogged' : 'Nominal'}
              </span>
            </div>

            {/* 2x2 Metric Tiles */}
            <div className="grid grid-cols-2 gap-2.5">
              <MetricTile
                label="Pending steps"
                value={pending}
                hint="In dispatch queue"
                alert={pending > 50}
              />
              <MetricTile
                label="Oldest pending"
                value={`${oldest}s`}
                hint="Queue latency"
                alert={oldest > 300}
              />
              <MetricTile
                label="Total artifacts"
                value={artifacts.count}
                hint="Execution outputs"
              />
              <MetricTile
                label="Storage used"
                value={`${(artifacts.sizeBytes / 1048576).toFixed(1)} MiB`}
                hint="Disk consumption"
              />
            </div>
          </div>
        </div>

        {/* Card 3: Safety & Circuit Controls */}
        <div className="flex flex-col justify-between rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs hover:border-border transition-colors">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-foreground/80 shadow-2xs">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="text-sm font-bold tracking-tight text-foreground truncate">
                  Safety & Circuit Controls
                </h3>
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                  isSafetyDegraded
                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/25'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isSafetyDegraded ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                  )}
                />
                {isSafetyDegraded ? 'Alerts Active' : 'Guarded'}
              </span>
            </div>

            {/* 2x2 Metric Tiles */}
            <div className="grid grid-cols-2 gap-2.5">
              <MetricTile
                label="Unknown outcomes"
                value={unknown}
                hint="Historical anomalies"
                alert={unknown > 0}
              />
              <MetricTile
                label="Expired leases"
                value={expiredLeases}
                hint="Orphaned locks"
                alert={expiredLeases > 0}
              />
              <MetricTile
                label="Tripped circuits"
                value={circuits}
                hint="Services at limit"
                alert={circuits > 0}
              />
              <MetricTile
                label="Dead-letter results"
                value={deadLetters}
                hint="Unrecoverable steps"
                alert={deadLetters > 0}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Agents Requiring Operator Attention Section */}
      <section
        aria-label="Agents requiring operator attention"
        className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs space-y-4"
      >
        {/* Section Header with Filter Tabs and Search */}
        <div className="flex flex-col gap-3.5 border-b border-border/60 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-foreground/80 shadow-2xs">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-foreground truncate">
                  Agents Requiring Attention
                </h2>
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground border border-border/60">
                  {unhealthyAgents.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Enrolled execution agents reporting offline, pending handshake, or degraded states.
              </p>
            </div>
          </div>

          {/* Controls: Search + Tabs */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Search Input */}
            <div className="relative w-44 sm:w-52 shrink-0">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder="Filter agent..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-lg border border-border/80 bg-background/80 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring transition-colors shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5 shadow-2xs text-xs font-medium shrink-0">
              <button
                type="button"
                onClick={() => setFilter('ALL')}
                className={cn(
                  'rounded-md px-2.5 py-1 transition-all',
                  filter === 'ALL'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                All ({evaluatedAgents.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('OFFLINE')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 transition-all',
                  filter === 'OFFLINE'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                Offline ({offlineCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('ENROLLING')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 transition-all',
                  filter === 'ENROLLING'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                Enrolling ({enrollingCount})
              </button>
              {errorCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter('ERROR')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 transition-all',
                    filter === 'ERROR'
                      ? 'bg-background text-rose-600 dark:text-rose-400 shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <AlertCircle className="h-3 w-3" />
                  Errors ({errorCount})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Global Alert for >20 unhealthy agents */}
        {totalUnhealthy && totalUnhealthy > 20 ? (
          <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs">
            <span className="text-muted-foreground">
              Showing first 20 of {totalUnhealthy} agents requiring operator attention
            </span>
            <Link
              href="/runbooks/agents?attention=1"
              className="font-medium text-primary hover:underline"
            >
              View all {totalUnhealthy} in Fleet Manager →
            </Link>
          </div>
        ) : null}

        {/* 2-Column Responsive Agents Grid */}
        {visibleAgents.length > 0 && (
          <div className="grid gap-3.5 grid-cols-1 md:grid-cols-2">
            {visibleAgents.map(agent => {
              const isOffline = agent.effectiveStatus === 'OFFLINE';
              const isEnrolling = agent.effectiveStatus === 'ENROLLING';

              return (
                <Link
                  key={agent.id}
                  href={`/runbooks/agents?attention=1&q=${encodeURIComponent(agent.name)}`}
                  className="group relative flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-4 transition-all hover:border-primary/40 hover:bg-muted/20 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* Top row: Agent Name + Status Badge */}
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={cn(
                          'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border shadow-2xs',
                          isOffline
                            ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : isEnrolling
                              ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                              : 'border-border bg-muted text-muted-foreground'
                        )}
                      >
                        <Bot className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                        {agent.name}
                      </span>
                    </div>
                    <RunbookStatusBadge status={agent.effectiveStatus} size="sm" />
                  </div>

                  {/* Middle row: Heartbeat timestamp + queue status */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
                      {agent.lastHeartbeatAt
                        ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, {
                            format: 'datetime',
                            includeTimeZone: true,
                          })
                        : 'Heartbeat never received'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground/80">
                      <span>•</span>
                      <span>{agent.spoolDepth} pending</span>
                      <span>•</span>
                      <span>{agent.deadLetterDepth} dead letter</span>
                    </span>
                  </div>

                  {/* Error callout banner if present */}
                  {agent.lastError && (
                    <div className="flex items-center gap-1.5 rounded-lg border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-[11px] font-mono text-destructive">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{agent.lastError}</span>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {/* Expand / Collapse Footer */}
        {filteredAgents.length > defaultPageSize && filter === 'ALL' && !searchQuery && (
          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-4 py-2 text-xs">
            <span className="text-muted-foreground">
              Showing {visibleAgents.length} of {filteredAgents.length} agents requiring attention
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-7 px-3 text-xs font-semibold rounded-lg shadow-2xs hover:bg-accent"
            >
              {expanded ? 'Show Fewer' : `Show All (${filteredAgents.length})`}
            </Button>
          </div>
        )}

        {/* Empty State when search/filter has 0 matches */}
        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 p-8 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Search className="h-4 w-4" />
            </span>
            <p className="text-xs font-medium text-foreground">
              No agents match your active filter
            </p>
            <p className="text-[11px] text-muted-foreground">
              {searchQuery
                ? `No agents found matching "${searchQuery}".`
                : 'No agents found for this state.'}
            </p>
            {(searchQuery || filter !== 'ALL') && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilter('ALL');
                  setSearchQuery('');
                }}
                className="h-7 text-xs font-medium mt-1"
              >
                Reset filters
              </Button>
            )}
          </div>
        )}

        {/* Empty state when total agents is 0 */}
        {unhealthyAgents.length === 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <p className="font-semibold text-foreground">No Agent alerts</p>
              <p className="text-muted-foreground">
                {totalAgentsCount
                  ? `All ${totalAgentsCount} enrolled Agents have registered healthy heartbeats.`
                  : 'No Agents enrolled. Add an outbound Agent to enable host-level execution.'}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-xl border p-3 transition-colors',
        alert
          ? 'border-rose-500/35 bg-rose-500/[0.04]'
          : 'border-border/50 bg-muted/20 hover:bg-muted/30'
      )}
    >
      <span className="text-[11px] font-medium text-muted-foreground truncate">{label}</span>
      <div className="my-1 flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-lg font-bold tabular-nums tracking-tight',
            alert ? 'text-destructive font-extrabold' : 'text-foreground'
          )}
        >
          {value}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground/75 truncate">{hint}</span>
    </div>
  );
}
