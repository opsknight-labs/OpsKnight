'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { ingestionPolicySchema, type IngestionPolicy } from '@/lib/ingestion/policy-schema';

const fields = [
  {
    key: 'criticalReservePercent',
    label: 'Backlog capacity reserved for critical source alerts (%)',
    min: 0,
    max: 50,
  },
  {
    key: 'receiptRetentionDays',
    label: 'Completed receipt and retry identity retention (days)',
    min: 31,
    max: 3650,
  },
  { key: 'maxPending', label: 'Maximum unfinished events', min: 64, max: 10000000 },
  {
    key: 'maxPendingBytes',
    label: 'Maximum unfinished payload bytes',
    min: 16777216,
    max: Number.MAX_SAFE_INTEGER,
  },
  { key: 'payloadRetentionHours', label: 'Completed payload retention (hours)', min: 1, max: 720 },
  { key: 'concurrency', label: 'Events processed concurrently per worker', min: 1, max: 32 },
  { key: 'pollMs', label: 'Idle polling interval (milliseconds)', min: 50, max: 30000 },
] as const;

/** Uses the same revision-checked command as operator API clients. */
export default function IngestionPolicyForm({
  policy,
  revision,
  onSaved,
}: {
  policy: IngestionPolicy;
  revision: number;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(policy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async event => {
        event.preventDefault();
        const parsed = ingestionPolicySchema.safeParse(draft);
        if (!parsed.success) {
          setError('Enter whole numbers within the displayed limits.');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const response = await fetch('/api/admin/ingestion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'configure',
              expectedRevision: revision,
              policy: parsed.data,
            }),
          });
          if (!response.ok) throw new Error('Save failed');
          await onSaved();
        } catch {
          setError(
            'Settings could not be saved. Refresh to load the latest revision before retrying.'
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Limits apply to new admissions. Reducing capacity preserves accepted work while it drains.
        Workers adopt changes between processing cycles; running transactions finish normally.
        Increasing concurrency also increases database work. Shorter retention can remove completed
        payloads on the next maintenance cycle; active retention holds remain protected. Completed
        receipt IDs and retry identities expire after their retention window. A later retry is
        treated as a new event and passes through normal incident deduplication.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map(field => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={`ingestion-${field.key}`}>{field.label}</Label>
            <Input
              id={`ingestion-${field.key}`}
              type="number"
              required
              step={1}
              min={field.min}
              max={field.max}
              disabled={busy}
              value={draft[field.key]}
              onChange={event =>
                setDraft(previous => ({ ...previous, [field.key]: Number(event.target.value) }))
              }
            />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save ingestion settings'}
      </Button>
    </form>
  );
}
