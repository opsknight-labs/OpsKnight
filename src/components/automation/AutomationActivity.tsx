'use client';
import { memo, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GitCompare,
  History,
  Loader2,
  Star,
  User,
  Clock,
} from 'lucide-react';
import { getAutomationVersionSnapshot } from '@/app/(app)/services/[id]/automation/actions';

import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { emptySnapshot, snapshotSchema, type Snapshot } from '@/lib/automation/contract';
import { semanticSnapshotChanges } from '@/lib/automation/diff';

import type { Data } from './presentation-types';

const PAGE_SIZE = 20;

function VersionComparison({ active, snapshot }: { active: Snapshot; snapshot: Snapshot }) {
  const changes = useMemo(() => semanticSnapshotChanges(active, snapshot), [active, snapshot]);
  return (
    <div className="space-y-2.5 border-t border-border/60 pt-3 text-xs">
      <details className="rounded-lg border border-border/70 bg-background/50">
        <summary className="cursor-pointer rounded-lg px-3 py-2 font-medium hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
          Full policy ({snapshot.rules.length} rules, {snapshot.fields.length} context fields)
        </summary>
        <ul className="space-y-1.5 border-t border-border/60 bg-muted/10 px-3 py-2.5 text-[11px] font-mono">
          {snapshot.rules.map(r => (
            <li key={r.id} className="text-foreground/90">
              <span className="font-semibold text-primary">[{r.phase}]</span> {r.name} ·{' '}
              {r.conditions.length} conditions ·{' '}
              <span className="text-muted-foreground">
                {r.actions.map(a => a.type.replaceAll('_', ' ').toLowerCase()).join(', ')}
              </span>
            </li>
          ))}
          {snapshot.rules.length === 0 && (
            <li className="text-muted-foreground">No rules defined.</li>
          )}
        </ul>
      </details>
      <div className="space-y-1">
        <p className="font-medium text-foreground">Changes compared with the active version:</p>
        {changes.length ? (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-background text-xs overflow-hidden">
            {changes.map((change, index) => {
              const isAdded = change.toLowerCase().includes('added');
              const isRemoved =
                change.toLowerCase().includes('removed') ||
                change.toLowerCase().includes('deleted');
              const isModified =
                change.toLowerCase().includes('modified') ||
                change.toLowerCase().includes('changed');

              return (
                <li
                  key={index}
                  className={cn(
                    'flex items-start gap-2.5 break-words px-3 py-2 text-foreground/90 border-l-2',
                    isAdded
                      ? 'border-l-emerald-500 bg-emerald-500/5'
                      : isRemoved
                        ? 'border-l-rose-500 bg-rose-500/5'
                        : isModified
                          ? 'border-l-amber-500 bg-amber-500/5'
                          : 'border-l-transparent'
                  )}
                >
                  <span className="flex-1">{change}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-muted-foreground">
            Identical configuration to active version
          </p>
        )}
      </div>
    </div>
  );
}

export const AutomationActivity = memo(function AutomationActivity({
  data,
  serviceId,
  activityPage,
  setActivityPage,
  versionView,
  setVersionView,
  busy,
  onRestore,
  onRestoreDraft,
}: {
  data: Data;
  serviceId: string;
  activityPage: number;
  setActivityPage: Dispatch<SetStateAction<number>>;
  versionView: string | null;
  setVersionView: (value: string | null) => void;
  busy: boolean;
  onRestore: (version: Data['versions'][number] & { snapshot: Snapshot }) => void;
  onRestoreDraft?: (versionId: string) => void;
}) {
  const [snapshots, setSnapshots] = useState<Map<string, Snapshot>>(() => new Map());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  const fetchSnapshot = async (versionId: string) => {
    setError('');
    setLoading(versionId);
    try {
      const snapshot = await getAutomationVersionSnapshot(serviceId, versionId);
      setSnapshots(current => new Map(current).set(versionId, snapshot));
      return snapshot;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load version');
    } finally {
      setLoading(null);
    }
  };

  const active = useMemo(
    () => snapshotSchema.safeParse(data.activeVersion?.snapshot ?? emptySnapshot),
    [data.activeVersion?.snapshot]
  );
  const pageCount = Math.max(1, Math.ceil(data.versionTotal / PAGE_SIZE));

  return (
    <div className="space-y-3.5">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
        >
          {error}
        </p>
      )}

      {data.versions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 p-8 text-center">
          <History className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No published versions yet.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Publish the draft to create the first immutable version. Every later publish or restore
            appears here.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-3">
          {data.versions.map((version, index) => {
            const isActive = version.id === data.activeVersionId;
            const expanded = versionView === version.id;
            const snapshot = snapshots.get(version.id);
            const isLast = index === data.versions.length - 1;

            return (
              <li key={version.id} className="relative pl-7">
                {/* Timeline connector line */}
                {!isLast && (
                  <div
                    aria-hidden="true"
                    className="absolute left-[11px] top-6 bottom-[-16px] w-[2px] bg-border/60"
                  />
                )}

                {/* Timeline node dot */}
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute left-[7px] top-4.5 h-2.5 w-2.5 rounded-full ring-4 transition-all',
                    isActive
                      ? 'bg-emerald-500 ring-emerald-500/20 shadow-xs'
                      : 'bg-muted-foreground/40 ring-background'
                  )}
                />

                <div
                  className={cn(
                    'overflow-hidden rounded-xl border bg-card p-3.5 transition-all shadow-xs',
                    isActive
                      ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                      : 'border-border/80 hover:border-border'
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground font-mono">
                          Version {version.versionNumber}
                        </h4>
                        {isActive && (
                          <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold">
                            <Star
                              className="h-3 w-3 fill-emerald-500 text-emerald-500"
                              aria-hidden="true"
                            />
                            Active
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {new Date(version.publishedAt).toLocaleString()}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1 font-medium text-foreground/80">
                          <User className="h-3 w-3" aria-hidden="true" />
                          {version.publisherName}
                        </span>
                        {version.sourceVersionId && (
                          <>
                            <span>·</span>
                            <span className="text-muted-foreground">
                              Restored from previous version
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5 text-xs font-medium"
                        aria-expanded={expanded}
                        disabled={loading === version.id}
                        onClick={async () => {
                          if (expanded) setVersionView(null);
                          else if (await fetchSnapshot(version.id)) setVersionView(version.id);
                        }}
                      >
                        {loading === version.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        View / compare
                      </Button>

                      {data.canPublish && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5 text-xs font-medium"
                          disabled={busy || loading === version.id}
                          onClick={async () => {
                            const loaded = await fetchSnapshot(version.id);
                            if (loaded) onRestore({ ...version, snapshot: loaded });
                          }}
                        >
                          <History className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore as new version
                        </Button>
                      )}

                      {data.canEdit && onRestoreDraft && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5 text-xs font-medium"
                          disabled={busy}
                          onClick={() => onRestoreDraft(version.id)}
                        >
                          <History className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore as draft
                        </Button>
                      )}
                    </div>
                  </div>

                  {expanded && snapshot && active.success && (
                    <div className="mt-3">
                      <VersionComparison active={active.data} snapshot={snapshot} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {data.versionTotal > 0 && (
        <nav
          aria-label="Version pages"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card p-2 text-xs shadow-xs"
        >
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs font-medium"
            disabled={activityPage <= 1}
            onClick={() => setActivityPage(page => page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Previous versions
          </Button>

          <span className="font-medium text-muted-foreground">
            Page {activityPage} of {pageCount} · {data.versionTotal} versions
          </span>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs font-medium"
            disabled={activityPage * PAGE_SIZE >= data.versionTotal}
            onClick={() => setActivityPage(page => page + 1)}
          >
            Next versions
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
});
