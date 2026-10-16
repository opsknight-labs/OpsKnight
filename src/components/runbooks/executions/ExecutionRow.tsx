'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Cpu,
  RotateCcw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { ExecutionProgressBar } from './ExecutionProgressBar';
import { formatDateTime } from '@/lib/timezone';
import { TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import { isTerminalExecutionStatus, type RunbookExecutionStatus } from '@/lib/runbooks/types';
import { cn } from '@/lib/utils';
import { executionDurationSeconds, formatDurationSeconds, formatRelativeTime } from './format';
import type { ExecutionItemData } from './ExecutionDetailDrawer';

/** Shared by the row and the list's sticky header so columns always align. */
export const EXECUTION_GRID =
  'grid grid-cols-2 lg:grid-cols-[8.5rem_minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_5.5rem_4.5rem_minmax(0,1.3fr)_5.5rem]';

export const EXECUTION_COLUMNS = [
  'Status',
  'Runbook',
  'Service / Incident',
  'Trigger',
  'Started',
  'Duration',
  'Target',
] as const;

export type ExecutionRowProps = {
  execution: ExecutionItemData;
  userTimeZone: string;
  onSelect: (execution: ExecutionItemData) => void;
  nowIso?: string;
  canExecute?: boolean;
};

function Cell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="mb-0.5 block text-[11px] text-muted-foreground lg:hidden">{label}</span>
      {children}
    </div>
  );
}

export function ExecutionRow({
  execution,
  userTimeZone,
  onSelect,
  nowIso,
  canExecute = false,
}: ExecutionRowProps) {
  const now = nowIso ?? execution.completedAt ?? execution.startedAt ?? execution.createdAt;
  const duration = formatDurationSeconds(
    executionDurationSeconds(execution.startedAt, execution.completedAt, now)
  );
  const startedValue = execution.startedAt ?? execution.createdAt;
  const startedAbsolute = formatDateTime(startedValue, userTimeZone, { format: 'datetime' });
  const target = execution.resolvedTargetAgent
    ? `Agent · ${execution.resolvedTargetAgent.name}`
    : execution.resolvedTargetAgentPool
      ? `Pool · ${execution.resolvedTargetAgentPool.name}`
      : 'Control plane';
  const trigger = execution.triggeredByType
    ? TRIGGER_LABELS[execution.triggeredByType]
    : 'Not reported';
  const title = `${execution.runbook.name} · v${execution.runbookVersion.version}`;
  const terminal = isTerminalExecutionStatus(execution.status as RunbookExecutionStatus);
  const TargetIcon = execution.resolvedTargetAgent
    ? Server
    : execution.resolvedTargetAgentPool
      ? Boxes
      : Cpu;
  const waitingApproval = execution.status === 'WAITING_APPROVAL' && Boolean(execution.incidentId);
  return (
    <li
      className={cn(
        'group relative rounded-xl border bg-card shadow-xs transition-colors hover:bg-muted/40 focus-within:bg-muted/40',
        'lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none lg:last:rounded-b-xl',
        waitingApproval && 'border-amber-500/40'
      )}
    >
      <div
        className={cn(
          EXECUTION_GRID,
          'gap-x-4 gap-y-3 p-3.5 text-xs lg:items-center lg:gap-y-1 lg:px-4 lg:py-3'
        )}
      >
        <div className="order-2 min-w-0 space-y-1.5 lg:order-none">
          <RunbookStatusBadge status={execution.status} size="sm" />
          <ExecutionProgressBar
            totalSteps={execution.totalSteps}
            completedSteps={execution.completedSteps}
            status={execution.status}
            className="max-w-[7.5rem]"
          />
        </div>
        <div className="order-first col-span-2 min-w-0 lg:order-none lg:col-span-1">
          <button
            type="button"
            aria-label={`Inspect execution ${execution.runbook.name} ${execution.id}`}
            onClick={() => onSelect(execution)}
            className="block max-w-full truncate rounded-sm text-left text-sm font-semibold text-foreground outline-none after:absolute after:inset-0 after:rounded-xl group-hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring lg:after:rounded-none"
            title={title}
          >
            {execution.runbook.name}
          </button>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="tabular-nums">v{execution.runbookVersion.version}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate font-mono" title={execution.id}>
              {execution.id.slice(0, 10)}
            </span>
          </span>
        </div>
        <Cell label="Service / Incident" className="col-span-2 lg:col-span-1">
          <span
            className="block truncate font-medium text-foreground"
            title={execution.service?.name ?? 'No service'}
          >
            {execution.service?.name || 'No service'}
          </span>
          {execution.incidentId ? (
            <Link
              className="relative z-10 block truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={`/incidents/${execution.incidentId}?tab=runbooks`}
              title={execution.incidentTitle ?? execution.incidentId}
            >
              {execution.incidentTitle || 'View incident'}
            </Link>
          ) : (
            <span className="block text-muted-foreground">No incident</span>
          )}
        </Cell>
        <Cell label="Trigger" className="order-3 lg:order-none">
          <span className="block truncate">
            {trigger}
            {execution.triggeredByUser ? ` · ${execution.triggeredByUser.name}` : ''}
          </span>
        </Cell>
        <Cell label="Started" className="order-4 lg:order-none">
          <span className="tabular-nums" title={startedAbsolute}>
            {nowIso ? formatRelativeTime(startedValue, nowIso) : startedAbsolute}
          </span>
        </Cell>
        <Cell label="Duration" className="order-5 lg:order-none">
          <span className="tabular-nums">{duration}</span>
        </Cell>
        <Cell label="Target" className="order-6 col-span-2 lg:order-none lg:col-span-1">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={target}>
            <TargetIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{target}</span>
          </span>
        </Cell>
        <div className="relative z-10 order-last col-span-2 flex items-center justify-end gap-1 lg:order-none lg:col-span-1">
          {waitingApproval && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-amber-700 hover:text-amber-800 dark:text-amber-300"
              title="Review approval"
            >
              <Link
                href={`/incidents/${execution.incidentId}?tab=runbooks`}
                aria-label="Review approval"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          )}
          {terminal && canExecute && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onSelect(execution)}
              title={execution.rerunBlockedReason ?? 'Preview and re-run this execution'}
              aria-label={`Re-run ${execution.runbook.name}`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Open full execution"
          >
            <Link href={`/runbooks/executions/${execution.id}`} aria-label="Open full execution">
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
        {execution.failedStepName && (
          <p className="order-7 col-span-2 flex items-center gap-1.5 text-rose-600 dark:text-rose-400 lg:order-none lg:col-span-7 lg:col-start-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Step requires attention: <span className="font-mono">{execution.failedStepName}</span>
            </span>
          </p>
        )}
      </div>
    </li>
  );
}
