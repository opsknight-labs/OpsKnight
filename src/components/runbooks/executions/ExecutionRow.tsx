'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, Clock, ShieldAlert, User } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { ExecutionProgressBar } from './ExecutionProgressBar';
import { formatDateTime } from '@/lib/timezone';
import type { ExecutionItemData } from './ExecutionDetailDrawer';

export type ExecutionRowProps = {
  execution: ExecutionItemData;
  userTimeZone: string;
  onSelect: (execution: ExecutionItemData) => void;
};

export function ExecutionRow({ execution, userTimeZone, onSelect }: ExecutionRowProps) {
  const isWaitingApproval = execution.status === 'WAITING_APPROVAL';

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
      : '—';

  return (
    <div
      onClick={() => onSelect(execution)}
      className="group relative flex flex-col justify-between gap-3.5 rounded-xl border bg-card/70 p-4 transition-all hover:bg-card hover:border-primary/40 hover:shadow-2xs cursor-pointer"
    >
      {/* Top Bar: Title, Incident Context & Status Badge */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm sm:text-base tracking-tight text-foreground group-hover:text-primary transition-colors">
              {execution.runbook.name}
            </h3>
            <Badge variant="outline" className="text-[11px] font-mono px-1.5 py-0">
              v{execution.runbookVersion.version}
            </Badge>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            {execution.incidentId ? (
              <span className="font-medium text-foreground/80">
                {execution.incidentTitle || `Incident #${execution.incidentId.slice(0, 8)}`}
              </span>
            ) : (
              <span>Ad-hoc run</span>
            )}
            <span>·</span>
            <span>{execution.service?.name || 'No service binding'}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              {execution.triggeredByUser ? (
                <>
                  <User className="h-3 w-3" />
                  <span>Responder</span>
                </>
              ) : (
                <span>Automatic trigger</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          <RunbookStatusBadge status={execution.status} />

          {isWaitingApproval && execution.incidentId && (
            <Button
              asChild
              size="sm"
              variant="default"
              className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              onClick={e => e.stopPropagation()}
            >
              <Link href={`/incidents/${execution.incidentId}?tab=runbooks`}>
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Review Approval</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar (when total steps > 0 or running/failed) */}
      {execution.totalSteps > 0 && (
        <div className="pt-0.5">
          <ExecutionProgressBar
            totalSteps={execution.totalSteps}
            completedSteps={execution.completedSteps}
            status={execution.status}
          />
        </div>
      )}

      {/* Failure context banner */}
      {execution.failedStepName && (
        <div className="rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-1 text-xs text-rose-600 dark:text-rose-400">
          Failed at step: <span className="font-semibold">{execution.failedStepName}</span>
        </div>
      )}

      {/* Bottom Info Strip: Target, Timestamp, Duration */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground pt-1 border-t border-border/40">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <Bot className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span>{execution.resolvedTargetAgent?.name || 'Control plane'}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {execution.startedAt
              ? formatDateTime(execution.startedAt, userTimeZone, { format: 'time' })
              : formatDateTime(execution.createdAt, userTimeZone, { format: 'time' })}
          </span>
          <span>·</span>
          <span className="font-medium text-foreground">{durationText}</span>
        </div>
      </div>
    </div>
  );
}
