'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';

type Data = {
  mappings: Array<{
    scheduleId: string;
    usergroupId: string;
    enabled: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
  }>;
  schedules: Array<{ id: string; name: string }>;
  usergroups: Array<{ id: string; handle: string; name: string }> | null;
  canWrite: boolean;
};

/** Map an on-call schedule to a Slack user group so @oncall always pings the right people. */
export default function SlackOnCallSyncCard() {
  const [data, setData] = useState<Data | null>(null);
  const [scheduleId, setScheduleId] = useState('');
  const [usergroupId, setUsergroupId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/slack/oncall-sync');
      const body = await res.json();
      setData((body?.data ?? body) as Data);
    } catch {
      setData(null);
    }
  }, []);
  useEffect(() => {
    fetch('/api/slack/oncall-sync')
      .then(r => r.json())
      .then(body => setData((body?.data ?? body) as Data))
      .catch(() => setData(null));
  }, []);

  const send = async (method: 'POST' | 'DELETE', id: string, body?: object) => {
    setError(null);
    const res = await fetch(
      method === 'DELETE'
        ? `/api/slack/oncall-sync?scheduleId=${encodeURIComponent(id)}`
        : '/api/slack/oncall-sync',
      {
        method,
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      }
    );
    if (!res.ok) setError('Could not save the mapping.');
    await load();
  };

  if (!data) return null;
  const nameOf = (id: string) => data.schedules.find(s => s.id === id)?.name ?? id;

  return (
    <div className="rounded-lg border border-border bg-card p-5 sm:p-6 shadow-xs space-y-3">
      <div>
        <h3 className="text-sm font-semibold">On-call user groups</h3>
        <p className="text-xs text-muted-foreground">
          Keeps a Slack user group equal to who is on call. Needs the usergroups:write scope
          {data.canWrite
            ? '.'
            : ' (not granted yet: reinstall the app with the updated manifest).'}{' '}
          The group is never emptied: if nobody matches, the last members stay.
        </p>
      </div>
      {data.mappings.map(m => (
        <div key={m.scheduleId} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate">
            <strong>{nameOf(m.scheduleId)}</strong> → {m.usergroupId}
            {m.lastError ? (
              <span className="text-destructive"> ({m.lastError})</span>
            ) : m.lastSyncedAt ? (
              <span className="text-muted-foreground"> (synced)</span>
            ) : null}
          </span>
          <span className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void send('POST', m.scheduleId, {
                  scheduleId: m.scheduleId,
                  usergroupId: m.usergroupId,
                  enabled: !m.enabled,
                })
              }
            >
              {m.enabled ? 'Pause' : 'Resume'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void send('DELETE', m.scheduleId)}
            >
              Remove
            </Button>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label="Schedule"
          className="rounded border bg-background px-2 py-1"
          value={scheduleId}
          onChange={e => setScheduleId(e.target.value)}
        >
          <option value="">Schedule…</option>
          {data.schedules.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {data.usergroups ? (
          <select
            aria-label="Slack user group"
            className="rounded border bg-background px-2 py-1"
            value={usergroupId}
            onChange={e => setUsergroupId(e.target.value)}
          >
            <option value="">User group…</option>
            {data.usergroups.map(g => (
              <option key={g.id} value={g.id}>
                @{g.handle}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Slack user group id"
            placeholder="User group id (S01ABC234)"
            className="rounded border bg-background px-2 py-1"
            value={usergroupId}
            onChange={e => setUsergroupId(e.target.value)}
          />
        )}
        <Button
          type="button"
          size="sm"
          disabled={!scheduleId || !usergroupId}
          onClick={() => void send('POST', scheduleId, { scheduleId, usergroupId })}
        >
          Link
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
