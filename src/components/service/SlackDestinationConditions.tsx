'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { DESTINATION_PRIORITIES, DESTINATION_URGENCIES } from '@/lib/slack/destination-conditions';

type Props = {
  serviceId: string;
  channelId: string;
  channelName: string | null;
  priorities: string[];
  urgencies: string[];
  onSaved: () => void;
};

/** Empty selection = every incident. Saving never removes a card that is already posted. */
export default function SlackDestinationConditions({
  serviceId,
  channelId,
  channelName,
  priorities,
  urgencies,
  onSaved,
}: Props) {
  const [prio, setPrio] = useState<string[]>(priorities);
  const [urg, setUrg] = useState<string[]>(urgencies);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    prio.slice().sort().join() !== priorities.slice().sort().join() ||
    urg.slice().sort().join() !== urgencies.slice().sort().join();

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/slack/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          channelId,
          channelName,
          priorities: prio,
          urgencies: urg,
        }),
      });
      if (!res.ok) throw new Error('Could not save the conditions.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the conditions.');
    } finally {
      setBusy(false);
    }
  };

  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded border px-1.5 py-0.5 text-[10px] font-medium',
        on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="basis-full space-y-1 pt-1 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Priorities">
        <span className="w-14">Priority</span>
        {DESTINATION_PRIORITIES.map(p => chip(p, prio.includes(p), () => setPrio(toggle(prio, p))))}
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Urgencies">
        <span className="w-14">Urgency</span>
        {DESTINATION_URGENCIES.map(u => chip(u, urg.includes(u), () => setUrg(toggle(urg, u))))}
        {dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="ml-2 rounded border border-primary px-1.5 py-0.5 text-primary"
          >
            Save
          </button>
        )}
      </div>
      <p>None selected posts every incident; changing it never removes an existing card.</p>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
