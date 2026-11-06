'use client';

import { useId, useState } from 'react';
import OpsKnightSquire, { type SquireState } from './OpsKnightSquire';
import SquireAvatar, { type SquireAvatarKind } from './SquireAvatar';

const STATES: ReadonlyArray<{ value: SquireState; label: string; detail: string }> = [
  { value: 'idle', label: 'Ready', detail: 'Waiting for a question.' },
  { value: 'greeting', label: 'Greeting', detail: 'A friendly welcome when a new chat opens.' },
  {
    value: 'listening',
    label: 'Listening',
    detail: 'Responds while someone types their question.',
  },
  {
    value: 'thinking',
    label: 'Thinking',
    detail: 'Investigating evidence or waiting for an answer.',
  },
  { value: 'speaking', label: 'Speaking', detail: 'An answer is arriving.' },
  { value: 'success', label: 'Success', detail: 'A confirmed action completed successfully.' },
  {
    value: 'alert',
    label: 'Needs attention',
    detail: 'An authorized high urgency incident needs attention.',
  },
  { value: 'error', label: 'Error', detail: 'An answer or action could not be completed.' },
  {
    value: 'offline',
    label: 'Sleeping / offline',
    detail: 'AI is off or limited. Basic answers still work while connected.',
  },
];

/** Local-only design preview: switching expressions never calls a provider or changes settings. */
export default function SquireAppearancePreview({
  name,
  avatar,
  animated,
}: {
  name: string;
  avatar: SquireAvatarKind;
  animated: boolean;
}) {
  const id = useId();
  const [state, setState] = useState<SquireState>('greeting');
  const selected = STATES.find(item => item.value === state)!;
  return (
    <section
      aria-label="Assistant appearance preview"
      className="rounded-2xl border border-border bg-muted/20 p-4"
    >
      <div className="flex items-center gap-5">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl bg-background">
          {avatar === 'SQUIRE' ? (
            <OpsKnightSquire state={state} size={96} animated={animated} label="" />
          ) : (
            <SquireAvatar kind={avatar} size="md" animated={animated} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Appearance preview
          </p>
          <p className="mt-1 truncate font-display text-lg font-semibold">
            {name.trim() || 'Squire'}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{selected.detail}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="text-xs font-medium">
          Expression
        </label>
        <select
          id={id}
          value={state}
          onChange={event => {
            const next = STATES.find(item => item.value === event.target.value);
            if (next) setState(next.value);
          }}
          className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
          disabled={avatar !== 'SQUIRE'}
        >
          {STATES.map(item => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <SquireAvatar kind={avatar} animated={animated} state={state} size="md" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        Preview only. Save below to apply your appearance settings. Reduced motion is always
        respected.
      </p>
    </section>
  );
}
