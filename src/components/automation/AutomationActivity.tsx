'use client';
import { memo, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronLeft, ChevronRight, GitCompare, History, Loader2, Star } from 'lucide-react';
import { getAutomationVersionSnapshot } from '@/app/(app)/services/[id]/automation/actions';

import { Button } from '@/components/ui/shadcn/button';

import { Badge } from '@/components/ui/shadcn/badge';
import { emptySnapshot, snapshotSchema, type Snapshot } from '@/lib/automation/contract';
import { semanticSnapshotChanges } from '@/lib/automation/diff';

import type { Data } from './presentation-types';

const PAGE_SIZE = 20;

function VersionComparison({ active, snapshot }: { active: Snapshot; snapshot: Snapshot }) {
  const changes = useMemo(() => semanticSnapshotChanges(active, snapshot), [active, snapshot]);
  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <details className="rounded-md border">
        <summary className="cursor-pointer rounded-md px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Full policy
        </summary>
        <ul className="space-y-1 border-t px-3 py-2">
          {snapshot.rules.map(r => (
            <li key={r.id}>
              {r.phase} · {r.name} · {r.conditions.length} conditions ·{' '}
              {r.actions.map(a => a.type.replaceAll('_', ' ').toLowerCase()).join(', ')}
            </li>
          ))}
          {snapshot.rules.length === 0 && <li className="text-muted-foreground">No rules.</li>}
        </ul>
      </details>
      <p className="font-medium">Changes compared with the active version:</p>
      {changes.length ? (
        <ul className="divide-y rounded-md border">
          {changes.map((change, index) => (
            <li key={index} className="break-words px-3 py-2">
              {change}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Same configuration</p>
      )}
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
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive dark:text-rose-300">
          {error}
        </p>
      )}
      {data.versions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <History className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No published versions yet.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Publish the draft to create the first immutable version. Every later publish or restore
            appears here.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {data.versions.map(version => {
            const isActive = version.id === data.activeVersionId;
            const expanded = versionView === version.id;
            const snapshot = snapshots.get(version.id);
            return (
              <li
                key={version.id}
                className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <h4 className="flex flex-wrap items-center gap-2 font-semibold">
                      Version {version.versionNumber}{' '}
                      {isActive && (
                        <Badge>
                          <Star className="h-3 w-3" aria-hidden="true" />
                          Active
                        </Badge>
                      )}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Published {new Date(version.publishedAt).toLocaleString()} ·{' '}
                      {version.publisherName}
                      {version.sourceVersionId ? ' · Restored from previous version' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 sm:h-9"
                      aria-expanded={expanded}
                      disabled={loading === version.id}
                      onClick={async () => {
                        if (expanded) setVersionView(null);
                        else if (await fetchSnapshot(version.id)) setVersionView(version.id);
                      }}
                    >
                      {loading === version.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <GitCompare aria-hidden="true" />
                      )}
                      View / compare
                    </Button>
                    {data.canPublish && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 sm:h-9"
                        disabled={busy || loading === version.id}
                        onClick={async () => {
                          const loaded = await fetchSnapshot(version.id);
                          if (loaded) onRestore({ ...version, snapshot: loaded });
                        }}
                      >
                        <History aria-hidden="true" />
                        Restore as new version
                      </Button>
                    )}
                  </div>
                </div>
                {expanded && snapshot && active.success && (
                  <VersionComparison active={active.data} snapshot={snapshot} />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {data.versionTotal > 0 && (
        <nav
          aria-label="Version pages"
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <Button
            size="sm"
            variant="outline"
            className="h-10 sm:h-9"
            disabled={activityPage <= 1}
            onClick={() => setActivityPage(page => page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
            Previous versions
          </Button>
          <span className="text-muted-foreground">
            Page {activityPage} of {pageCount} · {data.versionTotal} versions
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-10 sm:h-9"
            disabled={activityPage * PAGE_SIZE >= data.versionTotal}
            onClick={() => setActivityPage(page => page + 1)}
          >
            Next versions
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
});
