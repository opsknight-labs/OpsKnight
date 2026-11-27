'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Button } from '@/components/ui/shadcn/button';
import { NativeSelect } from '@/components/automation/authoring/primitives';
import {
  searchWarRoomAutoAddPeople,
  updateServiceWarRoomAutoAdd,
} from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';

type Person = { id: string; name: string | null; email: string };

export type WarRoomAutoAddCardProps = {
  serviceId: string;
  teamName: string | null;
  initialTeam: 'NONE' | 'MANAGERS' | 'ALL';
  initialUserIds: string[];
  /** The people already chosen plus a first page of suggestions. */
  people: Person[];
  canManage: boolean;
};

/** Always add chosen people to this service's war rooms: its team (all or managers) and anyone else. */
export default function WarRoomAutoAddCard({
  serviceId,
  teamName,
  initialTeam,
  initialUserIds,
  people,
  canManage,
}: WarRoomAutoAddCardProps) {
  const [state, formAction, pending] = useActionState(updateServiceWarRoomAutoAdd, undefined);
  const [team, setTeam] = useState(initialTeam);
  const [chosen, setChosen] = useState(() => new Set(initialUserIds));
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (state?.success) notify.success('War room people saved.');
  }, [state]);

  const [known, setKnown] = useState<Map<string, Person>>(
    () => new Map(people.map(person => [person.id, person]))
  );
  const [results, setResults] = useState<Person[]>([
    ...new Map(people.map(p => [p.id, p])).values(),
  ]);
  // Search the whole directory on the server, so nobody is out of reach in a large workspace.
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    const timer = setTimeout(() => {
      searchWarRoomAutoAddPeople(serviceId, filter)
        .then(found => {
          if (!live) return;
          setResults(found);
          setKnown(prev => new Map([...prev, ...found.map(p => [p.id, p] as const)]));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filter, serviceId, canManage]);
  // Chosen people stay visible (and removable) whatever the search shows.
  const shown = [
    ...[...chosen].map(id => known.get(id) ?? { id, name: null, email: id }),
    ...results.filter(person => !chosen.has(person.id)),
  ];
  const toggle = (id: string) =>
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form
      // Not `action=`: React resets a form after an action, which blanked the fields until a reload.
      onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <input type="hidden" name="serviceId" value={serviceId} />
      {[...chosen].map(id => (
        <input key={id} type="hidden" name="userIds" value={id} />
      ))}
      <div>
        <h3 className="text-sm font-semibold">Always add to the war room</h3>
        <p className="text-xs text-muted-foreground">
          These people join every new war room for this service, on top of the assignee, role
          holders and on-call. They need an account whose email matches their Slack or Teams
          account.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="warRoomAutoAddTeam" className="text-xs">
          {teamName ? `Team: ${teamName}` : 'Team'}
        </Label>
        <NativeSelect
          id="warRoomAutoAddTeam"
          name="warRoomAutoAddTeam"
          value={team}
          disabled={!canManage || !teamName}
          onChange={e => setTeam(e.target.value as typeof team)}
        >
          <option value="NONE">Nobody from the team</option>
          <option value="MANAGERS">Team owners and admins</option>
          <option value="ALL">Everyone on the team</option>
        </NativeSelect>
        {!teamName && (
          <p className="text-2xs text-muted-foreground">
            This service has no team; you can still add people below.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Other people (up to 25, anyone, not only the team)</Label>
        <Input
          aria-label="Search people"
          placeholder="Search by name or email"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          disabled={!canManage}
        />
        <div className="max-h-44 space-y-1 overflow-auto rounded border p-2">
          {shown.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={chosen.has(p.id)}
                onChange={() => toggle(p.id)}
                disabled={!canManage}
              />
              <span className="truncate">
                {p.name || p.email} <span className="text-muted-foreground">{p.email}</span>
              </span>
            </label>
          ))}
          {shown.length === 0 && <p className="text-xs text-muted-foreground">No match.</p>}
        </div>
        <p className="text-2xs text-muted-foreground">{chosen.size} selected</p>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      {canManage && (
        <Button type="submit" size="sm" disabled={pending || chosen.size > 25}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
    </form>
  );
}
