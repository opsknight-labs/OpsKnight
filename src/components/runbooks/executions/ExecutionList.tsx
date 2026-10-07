'use client';

import React, { useState } from 'react';
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
};

export function ExecutionList({ executions, userTimeZone, totalCount }: ExecutionListProps) {
  const [selectedExecution, setSelectedExecution] = useState<ExecutionItemData | null>(null);

  const runningCount = executions.filter(e => e.status === 'RUNNING').length;
  const waitingApprovalCount = executions.filter(e => e.status === 'WAITING_APPROVAL').length;
  const failedCount = executions.filter(e => e.status === 'FAILED' || e.status === 'TIMED_OUT').length;

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

      {/* Execution Rows */}
      <div className="space-y-2.5">
        {executions.map(execution => (
          <ExecutionRow
            key={execution.id}
            execution={execution}
            userTimeZone={userTimeZone}
            onSelect={setSelectedExecution}
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
        onOpenChange={open => !open && setSelectedExecution(null)}
        userTimeZone={userTimeZone}
      />
    </section>
  );
}
