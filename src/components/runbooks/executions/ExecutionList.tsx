'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRunbookRefresh } from '../useRunbookRefresh';
import { RunbookRefreshIndicator } from '../RunbookLiveRefresh';
import { Play } from 'lucide-react';
import { EmptyHint } from '../ui/primitives';
import { cn } from '@/lib/utils';
import { EXECUTION_COLUMNS, EXECUTION_GRID, ExecutionRow } from './ExecutionRow';
import { ExecutionDetailDrawer, type ExecutionItemData } from './ExecutionDetailDrawer';
import { ACTIVE_EXECUTION_STATUSES } from '@/lib/runbooks/presentation/contracts';

export type ExecutionListProps = {
  executions: ExecutionItemData[];
  userTimeZone: string;
  totalCount: number;
  activeCount?: number;
  nowIso?: string;
  canExecute?: boolean;
  hasFilters?: boolean;
};

export function ExecutionList({
  executions,
  userTimeZone,
  totalCount,
  activeCount: propActiveCount,
  nowIso,
  canExecute = false,
  hasFilters = false,
}: ExecutionListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedExecution = executions.find(item => item.id === selectedId) ?? null;
  const router = useRouter();

  const activeCount =
    propActiveCount ??
    executions.filter(e => (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(e.status))
      .length;

  const isSelectedActive = selectedExecution
    ? (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(selectedExecution.status)
    : false;
  const hasActive = activeCount > 0 || isSelectedActive;
  const { lastRefreshedAt, refreshNow } = useRunbookRefresh(router, {
    enabled: true,
    active: hasActive,
    intervalMs: 15000,
    refreshOnFocus: true,
  });

  return (
    <section className="space-y-2.5" aria-label="Recent executions">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground tabular-nums">{totalCount}</span>{' '}
          {totalCount === 1 ? 'execution' : 'executions'}
          {activeCount > 0 && <span className="tabular-nums"> · {activeCount} in progress</span>}
        </p>
        <RunbookRefreshIndicator lastRefreshedAt={lastRefreshedAt} onRefresh={refreshNow} />
      </div>

      {executions.length > 0 ? (
        <div className="overflow-hidden lg:rounded-2xl lg:border lg:border-border/80 dark:lg:border-border/60 lg:bg-card/90 dark:lg:bg-card/50 lg:backdrop-blur-xs lg:shadow-xs">
          <div
            aria-hidden="true"
            className={cn(
              EXECUTION_GRID,
              'sticky top-0 z-10 hidden gap-x-4 border-b border-border/60 bg-muted/60 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur-xs lg:grid'
            )}
          >
            {EXECUTION_COLUMNS.map(column => (
              <span key={column}>{column}</span>
            ))}
            <span className="text-right">Actions</span>
          </div>
          <ul className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-border/60">
            {executions.map(execution => (
              <ExecutionRow
                key={execution.id}
                execution={execution}
                userTimeZone={userTimeZone}
                nowIso={nowIso}
                canExecute={canExecute}
                onSelect={item => setSelectedId(item.id)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <EmptyHint
          icon={Play}
          title="No executions found"
          description={
            hasFilters
              ? 'No runs match these filters. Try a wider time range or clear the status filter.'
              : 'No runbooks have run yet. Preview and run a runbook from a service rule or an incident to see its history here.'
          }
          className="bg-card"
        />
      )}

      <ExecutionDetailDrawer
        execution={selectedExecution}
        open={Boolean(selectedExecution)}
        onOpenChange={open => !open && setSelectedId(null)}
        userTimeZone={userTimeZone}
        nowIso={nowIso}
        canExecute={canExecute}
      />
    </section>
  );
}
