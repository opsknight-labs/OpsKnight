'use client';
import { type Dispatch, type SetStateAction } from 'react';

import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';

import { Badge } from '@/components/ui/shadcn/badge';
import { emptySnapshot, snapshotSchema } from '@/lib/automation/contract';
import { semanticSnapshotChanges } from '@/lib/automation/diff';

import type { Data } from './presentation-types';
export function AutomationActivity({
  data,
  activityPage,
  setActivityPage,
  versionView,
  setVersionView,
  busy,
  onRestore,
}: {
  data: Data;
  activityPage: number;
  setActivityPage: Dispatch<SetStateAction<number>>;
  versionView: string | null;
  setVersionView: (value: string | null) => void;
  busy: boolean;
  onRestore: (version: Data['versions'][number]) => void;
}) {
  return (
    <div className="space-y-3">
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
                onClick={() => setVersionView(versionView === version.id ? null : version.id)}
              >
                View / compare
              </Button>
              {data.canPublish && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    onRestore(version);
                  }}
                >
                  Restore as new version
                </Button>
              )}
            </div>
            {versionView === version.id && (
              <div className="text-sm space-y-2">
                <details>
                  <summary className="cursor-pointer">Full policy</summary>
                  {snapshotSchema.parse(version.snapshot).rules.map(r => (
                    <p key={r.id}>
                      {r.phase} · {r.name} · {r.conditions.length} conditions ·{' '}
                      {r.actions.map(a => a.type.replaceAll('_', ' ').toLowerCase()).join(', ')}
                    </p>
                  ))}
                </details>
                <p>Changes compared with the active version:</p>
                {semanticSnapshotChanges(
                  snapshotSchema.parse(data.activeVersion?.snapshot ?? emptySnapshot),
                  snapshotSchema.parse(version.snapshot)
                ).map((change, index) => (
                  <p key={index}>{change}</p>
                ))}
                {semanticSnapshotChanges(
                  snapshotSchema.parse(data.activeVersion?.snapshot ?? emptySnapshot),
                  snapshotSchema.parse(version.snapshot)
                ).length === 0 && <p>Same configuration</p>}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
