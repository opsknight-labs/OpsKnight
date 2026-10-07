import React from 'react';
import Link from 'next/link';
import { ArrowRight, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { formatDateTime } from '@/lib/timezone';

export type RunbookCardData = {
  id: string;
  name: string;
  description: string;
  publishedVersion: number | null;
  draftVersion: number | null;
  bindings: number;
  executions: number;
  archivedAt?: string | null;
  updatedAt: string;
  sampleServices?: string[];
  lastExecution?: {
    id: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
};

export type RunbookCardProps = {
  runbook: RunbookCardData;
  userTimeZone: string;
  canManage?: boolean;
};

export function RunbookCard({ runbook, userTimeZone }: RunbookCardProps) {
  const isArchived = Boolean(runbook.archivedAt);
  const isPublished = !isArchived && runbook.publishedVersion !== null;

  const statusLabel = isArchived
    ? 'ARCHIVED'
    : isPublished
      ? 'PUBLISHED'
      : 'DRAFT';

  // Last execution summary
  const lastExec = runbook.lastExecution;
  const lastExecDurationSec =
    lastExec?.startedAt
      ? Math.max(
          0,
          Math.round(
            ((lastExec.completedAt ? new Date(lastExec.completedAt) : new Date()).getTime() -
              new Date(lastExec.startedAt).getTime()) /
              1000
          )
        )
      : null;

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-xl border p-5 shadow-2xs transition-all ${
        isArchived
          ? 'bg-muted/30 border-border/80 opacity-80'
          : 'bg-card/90 border-border hover:border-primary/40 hover:shadow-xs hover:bg-card'
      }`}
    >
      <div className="space-y-3">
        {/* Top Header: Title, Status Badge, Version info */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-heading text-base sm:text-lg font-bold tracking-tight">
                <Link
                  href={`/runbooks/${runbook.id}`}
                  className="text-foreground group-hover:text-primary transition-colors underline-offset-4 hover:underline"
                >
                  {runbook.name}
                </Link>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
            <RunbookStatusBadge status={statusLabel} />
            {isPublished && (
              <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                v{runbook.publishedVersion}
              </Badge>
            )}
            {runbook.draftVersion && isPublished && (
              <Badge variant="secondary" className="text-[11px] px-1.5 py-0 text-amber-600 dark:text-amber-400">
                draft v{runbook.draftVersion} pending
              </Badge>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="line-clamp-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          {runbook.description || 'No description provided for this operational workflow.'}
        </p>

        {/* Operational Context: Service Bindings & Targets */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
          <div className="flex items-center gap-1.5">
            <Workflow className="h-3.5 w-3.5 text-muted-foreground/70" />
            <span className="font-medium text-foreground">
              {runbook.bindings} {runbook.bindings === 1 ? 'service binding' : 'service bindings'}
            </span>
          </div>

          {runbook.sampleServices && runbook.sampleServices.length > 0 && (
            <div className="flex items-center gap-1">
              <span>·</span>
              <span className="text-muted-foreground font-mono text-[11px] truncate max-w-[200px]">
                {runbook.sampleServices.join(', ')}
              </span>
            </div>
          )}

          {isArchived && (
            <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium">
              · All service bindings disabled
            </span>
          )}
        </div>
      </div>

      {/* Operational Stats Strip & Actions */}
      <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Last Execution Info */}
          {lastExec ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]">Last run:</span>
              <RunbookStatusBadge status={lastExec.status} size="sm" showIcon={false} />
              {lastExecDurationSec !== null && (
                <span className="font-mono text-[11px]">({lastExecDurationSec}s)</span>
              )}
            </div>
          ) : (
            <span className="text-[11px] italic">No execution history yet</span>
          )}

          <span>·</span>
          <span>{runbook.executions} total runs</span>
          <span>·</span>
          <span>Updated {formatDateTime(runbook.updatedAt, userTimeZone, { format: 'date' })}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
            <Link href={`/runbooks/${runbook.id}`}>
              <span>Open</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
