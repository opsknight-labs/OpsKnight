import React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Clock, Hash, Layers, PlayCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { Pill } from '../ui/primitives';
import { formatDateTime } from '@/lib/timezone';
import { formatRelativeShort } from '@/lib/mobile-time';
import { cn } from '@/lib/utils';

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
  density?: 'grid' | 'list';
  updatedLabel?: string;
};

const MAX_VISIBLE_TAGS = 4;

function plural(count: number, word: string) {
  return `${new Intl.NumberFormat('en-US').format(count)} ${word}${count === 1 ? '' : 's'}`;
}

export function RunbookCard({
  runbook,
  userTimeZone,
  density = 'grid',
  updatedLabel,
}: RunbookCardProps) {
  const isArchived = Boolean(runbook.archivedAt);
  const isPublished = !isArchived && runbook.publishedVersion !== null;
  const statusLabel = isArchived ? 'ARCHIVED' : isPublished ? 'PUBLISHED' : 'DRAFT';
  const href = `/runbooks/${runbook.id}`;
  const isList = density === 'list';

  const tags = runbook.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = tags.length - visibleTags.length;
  const services = runbook.sampleServices ?? [];
  const updated =
    updatedLabel ?? formatDateTime(runbook.updatedAt, userTimeZone, { format: 'date' });
  const lastExec = runbook.lastExecution;

  const meta = (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground',
        isList && 'sm:justify-end'
      )}
    >
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
            title={formatDateTime(lastExec.createdAt, userTimeZone, { format: 'datetime' })}
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
        'group relative flex rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs transition-all duration-200 focus-within:border-primary/40 focus-within:shadow-md hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5',
        isList ? 'flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6' : 'flex-col p-5 sm:p-6',
        isArchived && 'bg-muted/30 opacity-75'
      )}
    >
      <div className={cn('min-w-0 flex-1', isList ? 'space-y-1.5' : 'space-y-3.5')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs group-hover:scale-105 transition-transform">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="min-w-0 text-base font-bold leading-snug tracking-tight">
              <Link
                href={href}
                className="break-words text-foreground outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:underline group-hover:text-primary transition-colors"
              >
                {runbook.name}
              </Link>
            </h2>
          </div>
          <div className="relative z-10 flex flex-wrap items-center justify-end gap-1.5 shrink-0">
            <RunbookStatusBadge status={statusLabel} size="sm" context="lifecycle" />
            {isPublished && <Pill className="font-mono">v{runbook.publishedVersion}</Pill>}
            {runbook.draftVersion && isPublished && (
              <Pill tone="warning" className="font-mono">
                draft v{runbook.draftVersion}
              </Pill>
            )}
          </div>
        </div>

        <p
          className={cn(
            'text-sm leading-relaxed text-muted-foreground',
            isList ? 'line-clamp-1' : 'line-clamp-2 min-h-[2lh]'
          )}
        >
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

      <div
        className={cn(
          'relative z-10 flex flex-wrap items-center justify-between gap-3',
          isList
            ? 'sm:shrink-0 sm:flex-col sm:items-end sm:gap-2'
            : 'mt-4 border-t border-border/60 pt-4'
        )}
      >
        {meta}
        <div className="flex items-center gap-3">
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
