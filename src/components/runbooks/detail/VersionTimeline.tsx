import Link from 'next/link';
import {
  Archive,
  Check,
  CheckCircle2,
  GitBranch,
  GitCompare,
  History,
  PencilLine,
} from 'lucide-react';
import { ConfirmAction, type RunbookFormAction } from '@/components/runbooks/RunbookControls';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { EmptyHint } from '@/components/runbooks/ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

export type VersionTimelineItem = {
  id: string;
  version: number;
  state: string;
  isCurrentPublished: boolean;
  isCurrentDraft: boolean;
  publishedByLabel: string | null;
  publishedAtLabel: string | null;
  createdAtLabel: string;
  checksum: string;
  executionCount: number;
  pinnedRuleCount: number;
  viewHref: string;
  compareHref: string | null;
  restoreAction?: RunbookFormAction;
  retireAction?: RunbookFormAction;
};

const NODE_CONFIG: Record<
  string,
  {
    ring: string;
    icon: typeof Check;
    iconClass: string;
  }
> = {
  PUBLISHED: {
    ring: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400/50 dark:bg-emerald-400/10 dark:text-emerald-400',
    icon: Check,
    iconClass: 'h-3.5 w-3.5',
  },
  DRAFT: {
    ring: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-400',
    icon: PencilLine,
    iconClass: 'h-3.5 w-3.5',
  },
  RETIRED: {
    ring: 'border-border/80 bg-muted/80 text-muted-foreground',
    icon: Archive,
    iconClass: 'h-3 w-3',
  },
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function VersionTimeline({ versions }: { versions: VersionTimelineItem[] }) {
  if (!versions.length) {
    return (
      <EmptyHint
        icon={GitBranch}
        title="No versions yet"
        description="Versions appear here once a draft is saved or published."
      />
    );
  }
  return (
    <ol aria-label="Version history" className="relative space-y-0">
      {versions.map((version, index) => {
        const isLast = index === versions.length - 1;
        const config = NODE_CONFIG[version.state] ?? NODE_CONFIG.RETIRED;
        const NodeIcon = config.icon;

        return (
          <li key={version.id} className="relative pb-6 last:pb-0">
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute left-[15px] top-8 -bottom-6 w-0.5 bg-border/60 dark:bg-border/40"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-3.5 flex h-8 w-8 items-center justify-center rounded-full border ring-4 ring-background shadow-2xs z-10 transition-colors',
                config.ring
              )}
            >
              <NodeIcon className={config.iconClass} strokeWidth={2.5} aria-hidden="true" />
            </span>
            <article
              className={cn(
                'ml-12 flex flex-col gap-3.5 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 shadow-xs hover:border-border hover:shadow-md transition-all duration-200 sm:flex-row sm:items-start sm:justify-between',
                version.isCurrentPublished &&
                  'border-emerald-500/40 bg-emerald-500/[0.02] dark:border-emerald-500/30 dark:bg-emerald-500/[0.03]',
                version.isCurrentDraft &&
                  'border-amber-500/40 bg-amber-500/[0.02] dark:border-amber-500/30 dark:bg-amber-500/[0.03]'
              )}
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="!text-sm !leading-snug font-semibold">
                    <Link
                      className="rounded-sm text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={version.viewHref}
                    >
                      Version {version.version}
                    </Link>
                  </h3>
                  <RunbookStatusBadge status={version.state} context="lifecycle" size="sm" />
                  {version.isCurrentPublished && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shadow-2xs">
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Live</span>
                    </span>
                  )}
                  {version.isCurrentDraft && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 shadow-2xs">
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Editable Draft</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {version.publishedAtLabel
                    ? `Published ${version.publishedAtLabel}${
                        version.publishedByLabel ? ` by ${version.publishedByLabel}` : ''
                      }`
                    : `Created ${version.createdAtLabel}`}
                </p>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex gap-1">
                    <dt>Checksum</dt>
                    <dd className="font-mono text-foreground/80" title={version.checksum}>
                      {version.checksum.slice(0, 12)}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="sr-only">Executions</dt>
                    <dd className="tabular-nums">{plural(version.executionCount, 'execution')}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="sr-only">Pinned rules</dt>
                    <dd className="tabular-nums">
                      {plural(version.pinnedRuleCount, 'pinned rule')}
                    </dd>
                  </div>
                </dl>
              </div>
              {(version.compareHref || version.restoreAction || version.retireAction) && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {version.compareHref && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-xl text-xs gap-1.5 shadow-2xs"
                    >
                      <Link href={version.compareHref}>
                        <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                        Compare with published
                      </Link>
                    </Button>
                  )}
                  {version.restoreAction && (
                    <ConfirmAction
                      action={version.restoreAction}
                      label="Restore as draft"
                      variant="outline"
                      title={`Restore version ${version.version} as a draft?`}
                      description="Creates the next editable draft from this version's definition and inputs. Published versions stay unchanged."
                      successMessage="Draft created"
                    />
                  )}
                  {version.retireAction && (
                    <ConfirmAction
                      action={version.retireAction}
                      label="Retire"
                      variant="outline"
                      title={`Retire version ${version.version}?`}
                      description="Marks this superseded version as retired. It stays in history with its executions. Rules still pinned to it must be moved first."
                      successMessage="Version retired"
                    />
                  )}
                </div>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
