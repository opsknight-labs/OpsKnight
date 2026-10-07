'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ExternalLink, Layers } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/shadcn/sheet';
import { Button } from '@/components/ui/shadcn/button';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { ExecutionProgressBar } from './ExecutionProgressBar';
import { formatDateTime } from '@/lib/timezone';

export type ExecutionItemData = {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  service: { id?: string; name: string } | null;
  incidentId: string | null;
  incidentTitle?: string | null;
  runbook: { id: string; name: string };
  runbookVersion: { version: number };
  resolvedTargetAgent: { name: string } | null;
  triggeredByUser: { name: string } | null;
  totalSteps: number;
  completedSteps: number;
  failedStepName?: string | null;
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
};

export function ExecutionDetailDrawer({
  execution,
  open,
  onOpenChange,
  userTimeZone,
}: ExecutionDetailDrawerProps) {
  if (!execution) return null;

  const durationSec = execution.startedAt
    ? Math.max(
        0,
        Math.round(
          ((execution.completedAt ? new Date(execution.completedAt) : new Date()).getTime() -
            new Date(execution.startedAt).getTime()) /
            1000
        )
      )
    : null;

  const durationText =
    durationSec !== null
      ? durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : `${durationSec}s`
      : 'Not started';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-6 space-y-6">
        <SheetHeader className="space-y-2 pb-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <RunbookStatusBadge status={execution.status} />
            <span className="font-mono text-xs text-muted-foreground select-all">
              {execution.id}
            </span>
          </div>
          <SheetTitle className="text-xl font-bold tracking-tight">
            {execution.runbook.name}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Version {execution.runbookVersion.version} · Executed via OpsKnight Automation Engine
          </SheetDescription>
        </SheetHeader>

        {/* Primary Operational Meta */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3.5 text-xs">
          <div>
            <span className="text-muted-foreground block text-[11px]">Service</span>
            <span className="font-semibold text-foreground">
              {execution.service?.name || 'Unbound execution'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Trigger Source</span>
            <span className="font-medium text-foreground">
              {execution.triggeredByUser ? `Responder (${execution.triggeredByUser.name})` : 'Automatic event trigger'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Target Agent</span>
            <span className="font-medium text-foreground">
              {execution.resolvedTargetAgent?.name || 'Local worker / pool'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Duration</span>
            <span className="font-medium text-foreground">{durationText}</span>
          </div>
        </div>

        {/* Incident Linking Card */}
        {execution.incidentId && (
          <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
            <div className="space-y-0.5">
              <span className="font-semibold text-primary">Attached Incident</span>
              <p className="text-muted-foreground">
                {execution.incidentTitle || `Incident ID ${execution.incidentId.slice(0, 10)}...`}
              </p>
            </div>
            <Button asChild size="sm" variant="default" className="gap-1 h-8 text-xs">
              <Link href={`/incidents/${execution.incidentId}?tab=runbooks`}>
                <span>View Incident</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}

        {/* Progress & Steps Summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span>Execution Steps</span>
            </h4>
            <span className="text-xs text-muted-foreground">
              {execution.completedSteps} of {execution.totalSteps} complete
            </span>
          </div>

          <ExecutionProgressBar
            totalSteps={execution.totalSteps}
            completedSteps={execution.completedSteps}
            status={execution.status}
            showLabel={false}
            className="max-w-none"
          />

          {execution.failedStepName && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
              <span className="font-semibold block">Failed Step:</span>
              <span>{execution.failedStepName}</span>
            </div>
          )}

          {execution.steps && execution.steps.length > 0 ? (
            <div className="divide-y rounded-lg border bg-card">
              {execution.steps.map((st, i) => (
                <div key={st.id || i} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">{i + 1}.</span>
                    <span className="font-medium">{st.stepKey}</span>
                  </div>
                  <RunbookStatusBadge status={st.status} size="sm" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border bg-card/60 p-4 text-center text-xs text-muted-foreground">
              Step traces are streaming live or available in the incident command center.
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Queued</span>
            <span className="font-mono">
              {formatDateTime(execution.createdAt, userTimeZone, { format: 'datetime' })}
            </span>
          </div>
          {execution.startedAt && (
            <div className="flex justify-between">
              <span>Started</span>
              <span className="font-mono">
                {formatDateTime(execution.startedAt, userTimeZone, { format: 'datetime' })}
              </span>
            </div>
          )}
          {execution.completedAt && (
            <div className="flex justify-between">
              <span>Completed</span>
              <span className="font-mono">
                {formatDateTime(execution.completedAt, userTimeZone, { format: 'datetime' })}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t">
          <Button asChild variant="outline" size="sm" className="gap-1 text-xs">
            <Link href={`/runbooks/${execution.runbook.id}`}>
              <span>Inspect Runbook</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>

          {execution.incidentId && (
            <Button asChild size="sm" className="gap-1 text-xs">
              <Link href={`/incidents/${execution.incidentId}?tab=runbooks`}>
                <span>Open Incident Console</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
