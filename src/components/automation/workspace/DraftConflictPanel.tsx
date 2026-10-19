'use client';
import { useState } from 'react';
import { Download, GitCompare, RefreshCw, Save, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { getAutomationArea } from '@/app/(app)/services/[id]/automation/actions';
import { compareSnapshots } from '@/lib/automation/diff';
import { snapshotSchema, type Snapshot } from '@/lib/automation/contract';
import { cn } from '@/lib/utils';
import { noticeClasses } from './status';

/** Resolves a revision conflict: compare, keep the local copy, take theirs, or download. */
export function DraftConflictPanel({
  serviceId,
  draft,
  onError,
  onKeepMine,
  onReloadTheirs,
}: {
  serviceId: string;
  draft: Snapshot;
  onError: (message: string) => void;
  onKeepMine: (remoteRevision: number) => Promise<boolean>;
  onReloadTheirs: () => void;
}) {
  const [remote, setRemote] = useState<{ snapshot: Snapshot; revision: number } | null>(null);
  const [pending, setPending] = useState(false);
  const review = async () => {
    setPending(true);
    try {
      const latest = await getAutomationArea(serviceId, 'rules');
      const parsed = snapshotSchema.safeParse(latest.draft.snapshot);
      if (!parsed.success) {
        onError('Stored draft failed integrity validation');
        return;
      }
      setRemote({ snapshot: parsed.data, revision: latest.draft.revision });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load the latest draft');
    } finally {
      setPending(false);
    }
  };
  const keepMine = async () => {
    if (!remote) return;
    setPending(true);
    try {
      await onKeepMine(remote.revision);
    } finally {
      setRemote(null);
      setPending(false);
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'automation-draft.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const changes = remote ? compareSnapshots(remote.snapshot, draft) : [];
  return (
    <section
      aria-label="Draft conflict"
      className={cn('space-y-3 rounded-lg border p-3 sm:p-4', noticeClasses.warn)}
    >
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">Someone else saved this draft</h3>
          <p className="text-sm">
            Your edits are kept in this browser. Compare both copies, then keep yours or load
            theirs. Publishing is paused until the conflict is resolved.
          </p>
        </div>
      </div>
      {remote && (
        <div className="space-y-1 rounded-md border bg-background p-3 text-sm text-foreground">
          <p className="font-medium">
            Your copy differs in {changes.length} {changes.length === 1 ? 'place' : 'places'}
          </p>
          {changes.length === 0 && (
            <p className="text-muted-foreground">Both copies are equivalent.</p>
          )}
          <ul className="list-disc space-y-0.5 pl-5">
            {changes.map((change, index) => (
              <li key={index}>{change}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {remote ? (
          <Button disabled={pending} className="h-10" onClick={() => void keepMine()}>
            <Save aria-hidden="true" />
            Keep my copy as a new draft revision
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={pending}
            className="h-10"
            onClick={() => void review()}
          >
            <GitCompare aria-hidden="true" />
            Review conflict
          </Button>
        )}
        <Button variant="outline" disabled={pending} className="h-10" onClick={onReloadTheirs}>
          <RefreshCw aria-hidden="true" />
          Reload their changes
        </Button>
        <Button variant="outline" className="h-10" onClick={download}>
          <Download aria-hidden="true" />
          Download my copy
        </Button>
      </div>
    </section>
  );
}
