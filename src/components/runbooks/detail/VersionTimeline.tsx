import Link from 'next/link';
import { GitBranch, GitCompare } from 'lucide-react';
import { ConfirmAction, type RunbookFormAction } from '@/components/runbooks/RunbookControls';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { EmptyHint, Pill } from '@/components/runbooks/ui/primitives';
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

const DOT_STYLES: Record<string, string> = {
  PUBLISHED: 'bg-emerald-500 ring-emerald-500/20',
  DRAFT: 'bg-amber-500 ring-amber-500/20',
  RETIRED: 'bg-muted-foreground/50 ring-muted-foreground/10',
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
    <ol aria-label="Version history" className="relative">
      {versions.map((version, index) => {
        const isLast = index === versions.length - 1;
        return (
          <li key={version.id} className="relative pb-5 pl-9 last:pb-0">
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[11px] top-7 w-px bg-border"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-[5px] top-[18px] h-3.5 w-3.5 rounded-full border-2 border-background ring-4',
                DOT_STYLES[version.state] ?? DOT_STYLES.RETIRED
              )}
            />
            <article
              className={cn(
                'flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between',
                version.isCurrentPublished && 'border-emerald-500/30',
                version.isCurrentDraft && 'border-amber-500/30'
              )}
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    <Link
                      className="rounded-sm text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={version.viewHref}
                    >
                      Version {version.version}
                    </Link>
                  </h3>
                  <RunbookStatusBadge status={version.state} context="lifecycle" size="sm" />
                  {version.isCurrentPublished && <Pill tone="success">Live</Pill>}
                  {version.isCurrentDraft && <Pill tone="warning">Editable</Pill>}
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
                    <Button asChild variant="outline" size="sm">
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
