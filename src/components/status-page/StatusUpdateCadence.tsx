'use client';

import { useState, useTransition } from 'react';
import { saveUpdateCadenceAction } from '@/app/(app)/settings/status-pages/helper-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';

/**
 * How often an open incident should post here. The incident page counts down to the next update from the
 * last announcement linked to it. Saved on its own: it is internal and never part of the public page.
 */
export default function StatusUpdateCadence({
  statusPageId,
  minutes,
}: {
  statusPageId: string;
  minutes: number | null;
}) {
  const [saved, setSaved] = useState(minutes);
  const [value, setValue] = useState(String(minutes ?? 30));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = Number(value);
  const dirty = parsed !== (saved ?? 30);

  return (
    <form
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2"
      onSubmit={event => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveUpdateCadenceAction({ statusPageId, minutes: parsed });
          setMessage(result.ok ? 'Saved' : result.error);
          if (result.ok) setSaved(parsed);
        });
      }}
    >
      <label htmlFor="status-update-cadence" className="text-xs text-muted-foreground">
        While an incident is open, post an update every
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="status-update-cadence"
          type="number"
          inputMode="numeric"
          min={5}
          max={1440}
          step={1}
          required
          value={value}
          onChange={event => {
            setValue(event.target.value);
            setMessage(null);
          }}
          className="h-11 w-20 text-sm tabular-nums"
        />
        <span className="text-xs text-muted-foreground">minutes</span>
      </div>
      {dirty && (
        <Button type="submit" variant="outline" size="sm" className="min-h-11" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {message}
      </span>
    </form>
  );
}
