import React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Clock, Hash, Layers, PlayCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { Pill } from '../ui/primitives';
import { formatDateTime } from '@/lib/timezone';
import { formatRelativeShort } from '@/lib/mobile-time';
import { cn } from '@/lib/utils';
import InsightBadge from '@/components/intelligence/insights/InsightBadge';
import type { OpsInsightCount } from '@/lib/intelligence/ops-insights/contract';

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
  /** Open operations insights on this runbook, for the badge; absent while runbook insights are off. */
  insights?: OpsInsightCount | null;
  sampleServices?: string[];
  ownerTeam?: { id: string; name: string } | null;
  tags?: string[];
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
  updatedLabel?: string;
};

export function runbookLifecycle(
  runbook: Pick<RunbookCardData, 'archivedAt' | 'publishedVersion'>
): 'ARCHIVED' | 'PUBLISHED' | 'DRAFT' {
  if (runbook.archivedAt) return 'ARCHIVED';
  return runbook.publishedVersion !== null ? 'PUBLISHED' : 'DRAFT';
}

const MAX_VISIBLE_TAGS = 4;

function plural(count: number, word: string) {
  return `${new Intl.NumberFormat('en-US').format(count)} ${word}${count === 1 ? '' : 's'}`;
}

export function RunbookCard({ runbook, userTimeZone, updatedLabel }: RunbookCardProps) {
  const statusLabel = runbookLifecycle(runbook);
  const isArchived = statusLabel === 'ARCHIVED';
  const isPublished = statusLabel === 'PUBLISHED';
  const href = `/runbooks/${runbook.id}`;

  const tags = runbook.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = tags.length - visibleTags.length;
  const services = runbook.sampleServices ?? [];
  const updated =
    updatedLabel ?? formatDateTime(runbook.updatedAt, userTimeZone, { format: 'date' });
  const lastExec = runbook.lastExecution;

  const meta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span
        className="inline-flex items-center gap-1.5"
        title={services.length ? services.join(', ') : undefined}
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="tabular-nums">{plural(runbook.bindings, 'service binding')}</span>
      </span>
      {lastExec ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="sr-only">Last run:</span>
          <RunbookStatusBadge status={lastExec.status} size="sm" context="execution" />
          <time
            dateTime={lastExec.createdAt}
            title={formatDateTime(lastExec.createdAt, userTimeZone, {
              format: 'datetime',
              includeTimeZone: true,
            })}
            suppressHydrationWarning
          >
            {formatRelativeShort(lastExec.createdAt, userTimeZone)}
          </time>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          Never run
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="tabular-nums">{plural(runbook.executions, 'run')}</span>
      </span>
    </div>
  );

  return (
    <article
      className={cn(
        'group relative flex flex-col rounded-lg border border-border bg-card p-3.5 shadow-xs transition-colors duration-150 focus-within:border-primary/50 hover:border-ink-300',
        isPublished && 'hover:border-emerald-500/40',
        !isPublished && !isArchived && 'hover:border-amber-500/40',
        isArchived && 'bg-muted/30 opacity-75 hover:opacity-100'
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
                isPublished
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : isArchived
                    ? 'bg-muted/60 text-muted-foreground border-border/60'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
              )}
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="min-w-0 text-sm !leading-snug font-semibold tracking-tight">
              <Link
                href={href}
                className="break-words text-foreground outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline group-hover:text-primary transition-colors"
              >
                {runbook.name}
              </Link>
            </h2>
          </div>
          <div className="relative z-10 flex flex-wrap items-center gap-1.5 shrink-0 sm:justify-end">
            <InsightBadge count={runbook.insights} />
            <RunbookStatusBadge status={statusLabel} size="sm" context="lifecycle" />
            {isPublished && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shadow-2xs">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
                  aria-hidden="true"
                />
                <span>Live v{runbook.publishedVersion}</span>
              </span>
            )}
            {runbook.draftVersion && isPublished && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 font-mono shadow-2xs">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                  aria-hidden="true"
                />
                <span>draft v{runbook.draftVersion}</span>
              </span>
            )}
          </div>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {runbook.description || 'No description yet.'}
        </p>

        <div className="relative z-10 flex flex-wrap items-center gap-1.5">
          {runbook.ownerTeam ? (
            <Pill icon={Users} tone="neutral" className="text-foreground font-medium">
              <span className="sr-only">Owner team: </span>
              {runbook.ownerTeam.name}
            </Pill>
          ) : (
            <Pill
              icon={Users}
              className="border border-dashed border-border bg-transparent text-muted-foreground ring-0"
            >
              No owner
            </Pill>
          )}
          {tags.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
              {visibleTags.map(tag => (
                <li key={tag}>
                  <Link
                    href={`/runbooks?tag=${encodeURIComponent(tag)}`}
                    aria-label={`Filter by tag ${tag}`}
                    className="inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground border border-border/80 bg-muted/40 shadow-2xs transition-colors hover:text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Hash className="h-2.5 w-2.5" aria-hidden="true" />
                    {tag}
                  </Link>
                </li>
              ))}
              {hiddenTagCount > 0 && (
                <li className="text-[11px] font-medium text-muted-foreground">+{hiddenTagCount}</li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        {meta}
        <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-3">
          <span className="text-xs text-muted-foreground">
            {isArchived ? 'Archived · bindings disabled' : `Updated ${updated}`}
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7.5 gap-1.5 rounded-lg px-2.5 text-xs font-semibold hover:bg-primary/10 hover:text-primary"
          >
            <Link href={href}>
              <span>Open</span>
              <ArrowRight
                className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
