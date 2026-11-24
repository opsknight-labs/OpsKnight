'use client';

import { useState, useTransition } from 'react';
import { notify as toast } from '@/lib/toast';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Switch } from '@/components/ui/shadcn/switch';
import { addMyMemory, deleteMyMemory, setMyMemoryEnabled, updateMyMemory } from './actions';

type Memory = { id: string; text: string };

/** The person's own Squire memory: the on/off switch, and each saved fact to edit or delete. */
export default function SquireMemoryPanel({
  memories,
  enabled,
  limits,
}: {
  memories: Memory[];
  enabled: boolean;
  limits: { items: number; chars: number };
}) {
  const [on, setOn] = useState(enabled);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Memory | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      try {
        const result = await work();
        if (result.ok) toast.success(done);
        else toast.error(result.error ?? 'Could not save. Try again.');
      } catch {
        toast.error('Could not save. Try again.');
      }
    });

  const toggle = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      try {
        await setMyMemoryEnabled(next);
        toast.success(next ? 'Memory turned on' : 'Memory turned off');
      } catch {
        setOn(!next);
        toast.error('Could not save. Try again.');
      }
    });
  };

  return (
    <SettingsSection
      title="Memory"
      description={`Tell Squire “remember I own the payments service” or “/remember I prefer short answers”. Up to ${limits.items} facts of ${limits.chars} characters each.`}
    >
      <SettingsRow
        label="Use my memories in answers"
        description="When off, your memories are kept but Squire does not use them."
      >
        <Switch
          checked={on}
          onCheckedChange={toggle}
          disabled={isPending}
          aria-label="Use my memories in Squire answers"
        />
      </SettingsRow>

      <form
        className="flex gap-2 py-4"
        onSubmit={event => {
          event.preventDefault();
          if (!draft.trim()) return;
          run(async () => {
            const result = await addMyMemory(draft);
            if (result.ok) setDraft('');
            return result;
          }, 'Saved');
        }}
      >
        <Input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          maxLength={limits.chars}
          placeholder="Something Squire should remember about you"
          aria-label="New memory"
          disabled={isPending || memories.length >= limits.items}
        />
        <Button type="submit" disabled={isPending || !draft.trim()}>
          Add
        </Button>
      </form>

      {memories.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Squire has nothing saved about you.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Your memories">
          {memories.map(memory => (
            <li key={memory.id} className="flex items-center gap-2 py-3">
              {editing?.id === memory.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    run(async () => {
                      const result = await updateMyMemory(memory.id, editing.text);
                      if (result.ok) setEditing(null);
                      return result;
                    }, 'Saved');
                  }}
                >
                  <Input
                    value={editing.text}
                    onChange={event => setEditing({ ...editing, text: event.target.value })}
                    maxLength={limits.chars}
                    aria-label="Edit memory"
                    autoFocus
                  />
                  <Button type="submit" size="sm" disabled={isPending || !editing.text.trim()}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm break-words">{memory.text}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setEditing(memory)}
                    aria-label={`Edit “${memory.text}”`}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => run(() => deleteMyMemory(memory.id), 'Deleted')}
                    aria-label={`Delete “${memory.text}”`}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
