'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Textarea } from '@/components/ui/shadcn/textarea';

const snapshotSchema = z.object({
  mode: z.enum(['sync', 'postgres']),
  counts: z.record(z.number()),
  pending: z.number(),
  pendingBytes: z.string(),
  oldestPendingAgeSeconds: z.number(),
  control: z.object({ paused: z.boolean() }),
  workers: z.array(z.object({ running: z.boolean(), lastError: z.string().nullable() })),
  throughput: z.object({
    windowSeconds: z.number(),
    acceptedPerSecond: z.number(),
    completedPerSecond: z.number(),
    limitedToTopIntegrations: z.boolean(),
    integrations: z.array(
      z.object({
        serviceId: z.string(),
        integrationId: z.string(),
        accepted: z.number(),
        completed: z.number(),
      })
    ),
  }),
  receipts: z.array(
    z.object({
      id: z.string(),
      serviceId: z.string(),
      failureCode: z.string().nullable(),
      attempts: z.number(),
    })
  ),
});

async function loadSnapshot() {
  const response = await fetch('/api/admin/ingestion', { cache: 'no-store' });
  if (!response.ok) throw new Error('Ingestion status is unavailable.');
  const body = await response.json();
  return snapshotSchema.parse(body.data);
}

/** Admin health uses the same operations API as external operator tooling. */
export default function IngestionHealthPanel() {
  const [snapshot, setSnapshot] = useState<z.infer<typeof snapshotSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadSnapshot());
      setError(null);
    } catch {
      setError('Ingestion status is unavailable. Refresh to try again.');
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    void loadSnapshot()
      .then(value => {
        if (mounted) setSnapshot(value);
      })
      .catch(() => {
        if (mounted) setError('Ingestion status is unavailable. Refresh to try again.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function command(action: 'pause' | 'resume' | 'replay' | 'archive', receiptId?: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/ingestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(receiptId ? { receiptId } : {}),
          ...(action === 'archive'
            ? { reason: archiveReason, confirmDiscardAcceptedEvent: true }
            : {}),
        }),
      });
      if (!response.ok) throw new Error('Ingestion command failed.');
      await refresh();
      if (action === 'archive') {
        setArchiveId(null);
        setArchiveReason('');
      }
    } catch {
      setError('The command could not be applied. Refresh and check the receipt status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingestion health</CardTitle>
        <CardDescription>
          Durably accepted alerts awaiting incident processing. Dead letters block later events with
          the same key until replay succeeds or an administrator explicitly archives them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {snapshot && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={snapshot.control.paused ? 'destructive' : 'secondary'}>
                {snapshot.mode === 'sync'
                  ? 'Synchronous processing'
                  : snapshot.control.paused
                    ? 'Admission paused'
                    : 'Admission open'}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {snapshot.workers.filter(worker => worker.running && !worker.lastError).length}{' '}
                workers reporting healthy
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <dt className="text-sm text-muted-foreground">Accepted / second</dt>
                <dd className="text-xl font-semibold">
                  {snapshot.throughput.acceptedPerSecond.toFixed(1)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Completed / second</dt>
                <dd className="text-xl font-semibold">
                  {snapshot.throughput.completedPerSecond.toFixed(1)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Pending</dt>
                <dd className="text-xl font-semibold">{snapshot.pending.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Oldest pending</dt>
                <dd className="text-xl font-semibold">
                  {Math.round(snapshot.oldestPendingAgeSeconds)}s
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Completed</dt>
                <dd className="text-xl font-semibold">
                  {(snapshot.counts.COMPLETED ?? 0).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Dead letters</dt>
                <dd className="text-xl font-semibold">
                  {(snapshot.counts.DEAD ?? 0).toLocaleString()}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Throughput is the last {snapshot.throughput.windowSeconds} seconds; only newly
              committed receipts count as accepted.{' '}
              {snapshot.throughput.limitedToTopIntegrations
                ? 'Values show the top 100 integrations.'
                : ''}
            </p>
            {snapshot.throughput.integrations.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm">Throughput by integration</summary>
                <ul className="space-y-2 pt-2 text-sm">
                  {snapshot.throughput.integrations.map(row => (
                    <li
                      key={`${row.serviceId}:${row.integrationId}`}
                      className="flex flex-wrap justify-between gap-2"
                    >
                      <span className="font-mono">{row.integrationId}</span>
                      <span>
                        {row.accepted} accepted · {row.completed} completed / minute
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Button
              disabled={busy || snapshot.mode === 'sync'}
              variant="outline"
              onClick={() => void command(snapshot.control.paused ? 'resume' : 'pause')}
            >
              {snapshot.control.paused ? 'Resume admission' : 'Pause admission'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Pausing admission lets accepted work drain. Replay retries the stored event and
              records an audit entry.
            </p>
            {snapshot.receipts.length > 0 && (
              <ul className="space-y-2" aria-label="Dead-letter receipts">
                {snapshot.receipts.map(receipt => (
                  <li
                    key={receipt.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                  >
                    <div>
                      <p className="font-mono break-all">{receipt.id}</p>
                      <p className="text-muted-foreground">
                        {receipt.failureCode} · {receipt.attempts} attempts
                      </p>
                    </div>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => void command('replay', receipt.id)}
                    >
                      Replay
                    </Button>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => {
                        setArchiveId(receipt.id);
                        setArchiveReason('');
                      }}
                    >
                      Archive
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Button disabled={busy} variant="outline" onClick={() => void refresh()}>
          Refresh ingestion status
        </Button>
      </CardContent>
      <Dialog
        open={archiveId !== null}
        onOpenChange={open => {
          if (!open && !busy) setArchiveId(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Archive accepted dead-letter event</DialogTitle>
          <DialogDescription>
            This discards the stored event payload and unblocks later events with the same identity.
            It cannot be replayed afterward. The receipt and audit record remain. Held evidence
            cannot be archived.
          </DialogDescription>
          <label htmlFor="ingestion-archive-reason">
            Reason for discarding this accepted event
          </label>
          <Textarea
            id="ingestion-archive-reason"
            value={archiveReason}
            maxLength={1000}
            onChange={event => setArchiveReason(event.target.value)}
          />
          <Button
            variant="destructive"
            disabled={busy || archiveReason.trim().length < 10}
            onClick={() => {
              if (archiveId) void command('archive', archiveId);
            }}
          >
            Discard payload and archive event
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
