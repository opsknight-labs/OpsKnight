'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRunbookRefresh } from '../useRunbookRefresh';
import { Play } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ExecutionRow } from './ExecutionRow';
import {
  ExecutionDetailDrawer,
  type ExecutionItemData,
} from './ExecutionDetailDrawer';

export type ExecutionListProps = {
  executions: ExecutionItemData[];
  userTimeZone: string;
  totalCount: number;
  runningCount?: number;
  waitingApprovalCount?: number;
  failedCount?: number;
};

export function ExecutionList({
  executions,
  userTimeZone,
  totalCount,
  runningCount: propRunningCount,
  waitingApprovalCount: propWaitingApprovalCount,
  failedCount: propFailedCount,
}: ExecutionListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedExecution = executions.find(item => item.id === selectedId) ?? null;
  const router = useRouter();

  const runningCount =
    propRunningCount ?? executions.filter(e => e.status === 'RUNNING').length;
  const waitingApprovalCount =
    propWaitingApprovalCount ?? executions.filter(e => e.status === 'WAITING_APPROVAL').length;
  const failedCount =
    propFailedCount ??
    executions.filter(e => e.status === 'FAILED' || e.status === 'TIMED_OUT').length;

  const hasActive = runningCount > 0 || waitingApprovalCount > 0 || Boolean(selectedId);
  useRunbookRefresh(router, { enabled: hasActive, refreshOnFocus: true });

  return (
    <section className="space-y-3" aria-label="Recent executions">
      {/* High-density summary header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{totalCount} executions</span>
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
              · {runningCount} running
            </span>
          )}
          {waitingApprovalCount > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
              · {waitingApprovalCount} waiting approval
            </span>
          )}
          {failedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
              · {failedCount} failed
            </span>
          )}
        </div>
      </div>

      <div aria-hidden="true" className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-3 text-xs text-muted-foreground"><span>Runbook / Incident</span><span>State</span><span>Progress</span><span>Target</span><span>Trigger</span><span>Started / Duration</span></div>
      {/* Execution Rows */}
      <div className="space-y-1.5">
        {executions.map(execution => (
          <ExecutionRow
            key={execution.id}
            execution={execution}
            userTimeZone={userTimeZone}
            onSelect={item => setSelectedId(item.id)}
          />
        ))}
      </div>

      {/* Empty State */}
      {executions.length === 0 && (
        <EmptyState
          icon={<Play />}
          title="No executions found"
          description="No automation runs match your current filter criteria. Try adjusting the status or time filters."
        />
      )}

      {/* Deep-dive slide-over sheet */}
      <ExecutionDetailDrawer
        execution={selectedExecution}
        open={Boolean(selectedExecution)}
        onOpenChange={open => !open && setSelectedId(null)}
        userTimeZone={userTimeZone}
      />
    </section>
  );
}
