'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { getAutomationVersionSnapshot } from '@/app/(app)/services/[id]/automation/actions';

import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';

import { Badge } from '@/components/ui/shadcn/badge';
import { emptySnapshot, snapshotSchema, type Snapshot } from '@/lib/automation/contract';
import { semanticSnapshotChanges } from '@/lib/automation/diff';

import type { Data } from './presentation-types';
export function AutomationActivity({
  data,
  serviceId,
  activityPage,
  setActivityPage,
  versionView,
  setVersionView,
  busy,
  onRestore,
}: {
  data: Data;
  serviceId: string;
  activityPage: number;
  setActivityPage: Dispatch<SetStateAction<number>>;
  versionView: string | null;
  setVersionView: (value: string | null) => void;
  busy: boolean;
  onRestore: (version: Data['versions'][number] & { snapshot: Snapshot }) => void;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const fetchSnapshot = async (versionId: string) => {
    setError('');
    setLoading(versionId);
    try {
      const snapshot = await getAutomationVersionSnapshot(serviceId, versionId);
      setSnapshots(current => ({ ...current, [versionId]: snapshot }));
      return snapshot;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load version');
    } finally {
      setLoading(null);
    }
  };
  const active = snapshotSchema.safeParse(data.activeVersion?.snapshot ?? emptySnapshot);
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 text-sm">
        <Button
          size="sm"
          variant="outline"
          disabled={activityPage <= 1}
          onClick={() => setActivityPage(page => page - 1)}
        >
          Previous versions
        </Button>
        <span>
          Page {activityPage} · {data.versionTotal} versions
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={activityPage * 20 >= data.versionTotal}
          onClick={() => setActivityPage(page => page + 1)}
        >
          Next versions
        </Button>
      </div>
      {data.versions.length === 0 && <p>No published versions yet.</p>}
      {data.versions.map(version => (
        <Card key={version.id}>
          <CardContent className="pt-5 space-y-2">
            <div className="font-medium">
              Version {version.versionNumber}{' '}
              {version.id === data.activeVersionId && <Badge>Active</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              Published {new Date(version.publishedAt).toLocaleString()} · {version.publisherName}
              {version.sourceVersionId ? ' · Restored from previous version' : ''}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loading === version.id}
                onClick={async () => {
                  if (versionView === version.id) setVersionView(null);
                  else if (await fetchSnapshot(version.id)) setVersionView(version.id);
                }}
              >
                View / compare
              </Button>
              {data.canPublish && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || loading === version.id}
                  onClick={async () => {
                    const snapshot = await fetchSnapshot(version.id);
                    if (snapshot) onRestore({ ...version, snapshot });
                  }}
                >
                  Restore as new version
                </Button>
              )}
            </div>
            {versionView === version.id && snapshots[version.id] && active.success && (
              <div className="text-sm space-y-2">
                <details>
                  <summary className="cursor-pointer">Full policy</summary>
                  {snapshots[version.id].rules.map(r => (
                    <p key={r.id}>
                      {r.phase} · {r.name} · {r.conditions.length} conditions ·{' '}
                      {r.actions.map(a => a.type.replaceAll('_', ' ').toLowerCase()).join(', ')}
                    </p>
                  ))}
                </details>
                <p>Changes compared with the active version:</p>
                {semanticSnapshotChanges(active.data, snapshots[version.id]).map(
                  (change, index) => (
                    <p key={index}>{change}</p>
                  )
                )}
                {semanticSnapshotChanges(active.data, snapshots[version.id]).length === 0 && (
                  <p>Same configuration</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
