'use client';

import React from 'react';
import { TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/shadcn/sheet';
import { Button } from '@/components/ui/shadcn/button';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { KeyValueGrid } from '../ui/primitives';
import { ExecutionProgressBar } from './ExecutionProgressBar';
import { ExecutionRerunPanel } from './ExecutionRerunPanel';
import { StepStatusIcon } from './StepStatusIcon';
import { executionDurationSeconds, formatDurationSeconds } from './format';
import { formatDateTime } from '@/lib/timezone';
import { isTerminalExecutionStatus, type RunbookExecutionStatus } from '@/lib/runbooks/types';

export type ExecutionItemData = {
  id: string;
  status: string;
  triggeredByType?: keyof typeof TRIGGER_LABELS;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  service: { id?: string; name: string } | null;
  incidentId: string | null;
  incidentTitle?: string | null;
  runbook: { id: string; name: string };
  runbookVersion: { version: number };
  resolvedTargetAgent: { name: string } | null;
  resolvedTargetAgentPool?: { id?: string; name: string } | null;
  triggeredByUser: { name: string } | null;
  totalSteps: number;
  completedSteps: number;
  failedStepName?: string | null;
  rerunBlockedReason?: string | null;
  steps?: Array<{
    id: string;
    stepKey: string;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
  }>;
};

export type ExecutionDetailDrawerProps = {
  execution: ExecutionItemData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userTimeZone: string;
  nowIso?: string;
  canExecute?: boolean;
};

export function ExecutionDetailDrawer({
  execution,
  open,
  onOpenChange,
  userTimeZone,
  nowIso,
  canExecute = false,
}: ExecutionDetailDrawerProps) {
  if (!execution) return null;

  const durationText = formatDurationSeconds(
    executionDurationSeconds(
      execution.startedAt,
      execution.completedAt,
      nowIso ?? execution.completedAt ?? execution.startedAt ?? execution.createdAt
    )
  );
  const terminal = isTerminalExecutionStatus(execution.status as RunbookExecutionStatus);
  const fmt = (value: string) => formatDateTime(value, userTimeZone, { format: 'datetime' });
  const target = execution.resolvedTargetAgent
    ? `Agent · ${execution.resolvedTargetAgent.name}`
    : execution.resolvedTargetAgentPool
      ? `Pool · ${execution.resolvedTargetAgentPool.name}`
      : 'Control plane';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full space-y-5 overflow-y-auto p-6 sm:max-w-xl">
        <SheetHeader className="space-y-2 border-b pb-4 text-left">
          <div className="flex items-center justify-between gap-3 pr-8">
            <RunbookStatusBadge status={execution.status} />
            <span
              className="select-all truncate font-mono text-[11px] text-muted-foreground"
              title={execution.id}
            >
              {execution.id}
            </span>
          </div>
          <SheetTitle
            className="truncate text-xl font-semibold tracking-tight"
            title={execution.runbook.name}
          >
            {execution.runbook.name}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Version {execution.runbookVersion.version}
            {execution.service ? ` · ${execution.service.name}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="gap-1.5">
            <Link href={`/runbooks/executions/${execution.id}`}>
              Open full execution <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          {execution.incidentId && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/incidents/${execution.incidentId}?tab=runbooks`}>
                View incident <ArrowUpRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="gap-1.5">
            <Link href={`/runbooks/${execution.runbook.id}`}>
              Inspect runbook <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>

        <section
          aria-label="Progress"
          className="space-y-3 rounded-xl border bg-card p-4 shadow-xs"
        >
          {execution.totalSteps > 0 ? (
            <ExecutionProgressBar
              totalSteps={execution.totalSteps}
              completedSteps={execution.completedSteps}
              status={execution.status}
              size="lg"
              className="max-w-none"
            />
          ) : (
            <p className="text-xs text-muted-foreground">No steps reported yet.</p>
          )}

          {execution.failedStepName && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Step requires attention:{' '}
                <span className="font-mono font-medium">{execution.failedStepName}</span>
              </span>
            </p>
          )}

          {execution.steps && execution.steps.length > 0 ? (
            <ol aria-label="Steps" className="relative space-y-0.5">
              {execution.steps.map((st, i) => (
                <li key={st.id || i} className="relative flex items-center gap-3 py-1.5 text-xs">
                  {i < execution.steps!.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[9px] top-6 h-[calc(100%-0.75rem)] w-px bg-border"
                    />
                  )}
                  <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background">
                    <StepStatusIcon status={st.status} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium" title={st.stepKey}>
                    {st.stepKey}
                  </span>
                  <RunbookStatusBadge status={st.status} size="sm" />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">
              Step details appear here once the run starts.
            </p>
          )}
        </section>

        <KeyValueGrid
          className="rounded-xl border bg-card p-4 shadow-xs"
          items={[
            { label: 'Service', value: execution.service?.name || 'No service' },
            {
              label: 'Trigger',
              value: `${execution.triggeredByType ? TRIGGER_LABELS[execution.triggeredByType] : 'Not reported'}${execution.triggeredByUser ? ` · ${execution.triggeredByUser.name}` : ''}`,
            },
            { label: 'Target', value: target },
            { label: 'Duration', value: <span className="tabular-nums">{durationText}</span> },
            {
              label: 'Queued',
              value: <span className="tabular-nums">{fmt(execution.createdAt)}</span>,
            },
            {
              label: 'Started',
              value: (
                <span className="tabular-nums">
                  {execution.startedAt ? fmt(execution.startedAt) : 'Not started'}
                </span>
              ),
            },
            ...(execution.completedAt
              ? [
                  {
                    label: 'Completed',
                    value: <span className="tabular-nums">{fmt(execution.completedAt)}</span>,
                  },
                ]
              : []),
            ...(execution.incidentId
              ? [
                  {
                    label: 'Incident',
                    value: execution.incidentTitle || 'View incident',
                    wide: true,
                  },
                ]
              : []),
          ]}
        />

        {terminal && (
          <ExecutionRerunPanel
            executionId={execution.id}
            blockedReason={execution.rerunBlockedReason ?? null}
            canExecute={canExecute}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
