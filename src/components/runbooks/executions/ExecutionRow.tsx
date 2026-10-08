'use client';
import Link from 'next/link';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { ExecutionProgressBar } from './ExecutionProgressBar';
import { formatDateTime } from '@/lib/timezone';
import { TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import type { ExecutionItemData } from './ExecutionDetailDrawer';
export type ExecutionRowProps = { execution: ExecutionItemData; userTimeZone: string; onSelect: (execution: ExecutionItemData) => void };
export function ExecutionRow({ execution, userTimeZone, onSelect }: ExecutionRowProps) {
  const duration = execution.startedAt ? Math.max(0, Math.round(((execution.completedAt ? new Date(execution.completedAt) : new Date()).getTime() - new Date(execution.startedAt).getTime()) / 1000)) : null;
  return <div className="rounded-lg border bg-card hover:bg-muted/30">
    <button type="button" aria-label={`Inspect execution ${execution.runbook.name} ${execution.id}`} onClick={() => onSelect(execution)} className="grid w-full gap-2 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] lg:items-center text-xs">
      <span className="min-w-0"><strong className="block truncate text-sm">{execution.runbook.name} · v{execution.runbookVersion.version}</strong><span className="block truncate text-muted-foreground">{execution.incidentTitle || 'Ad-hoc run'} · {execution.service?.name || 'No service'}</span></span>
      <span><RunbookStatusBadge status={execution.status} size="sm" /></span>
      <span><ExecutionProgressBar totalSteps={execution.totalSteps} completedSteps={execution.completedSteps} status={execution.status} /></span>
      <span className="truncate">
        {execution.resolvedTargetAgent
          ? `Agent · ${execution.resolvedTargetAgent.name}`
          : execution.resolvedTargetAgentPool
          ? `Pool · ${execution.resolvedTargetAgentPool.name}`
          : 'Control plane'}
      </span>
      <span>{execution.triggeredByType ? TRIGGER_LABELS[execution.triggeredByType] : 'Not reported'}</span>
      <span>{formatDateTime(execution.startedAt ?? execution.createdAt, userTimeZone, { format: 'datetime' })}<span className="block text-muted-foreground">{duration === null ? 'Not started' : `${duration}s`}</span></span>
      {execution.failedStepName && <span className="text-destructive lg:col-span-6">Step requires attention: {execution.failedStepName}</span>}
    </button>
    <div className="flex flex-wrap gap-4 border-t px-3 py-1.5 text-xs"><Link className="text-primary hover:underline" href={`/runbooks/executions/${execution.id}`}>Open full execution</Link>
      {execution.status === 'WAITING_APPROVAL' && execution.incidentId && <Link className="text-amber-700 dark:text-amber-300 hover:underline" href={`/incidents/${execution.incidentId}?tab=runbooks`}>Review approval</Link>}
    </div>
  </div>;
}
