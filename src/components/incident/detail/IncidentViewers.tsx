'use client';

import { useEffect, useState } from 'react';
import UserAvatar from '@/components/UserAvatar';
import type { PresenceViewer } from '@/lib/incidents/presence';
import { heartbeatIncidentPresence } from '../presence-actions';

const BEAT_MS = 30_000;
/** Never beat more often than this, however often the tab flips visible. */
const MIN_GAP_MS = 20_000;
const SHOWN = 4;
const NAMED = 10;

/**
 * Who else has this incident open right now. Heartbeats only while the tab is visible; each heartbeat
 * returns the current list, so there is no separate polling. Renders nothing when you are alone.
 */
export default function IncidentViewers({
  incidentId,
  currentUserId,
}: {
  incidentId: string;
  currentUserId: string;
}) {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let lastBeat = -Infinity;
    const beat = () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      if (Date.now() - lastBeat < MIN_GAP_MS) return;
      lastBeat = Date.now();
      inFlight = true;
      heartbeatIncidentPresence(incidentId)
        .then(list => {
          if (alive) setViewers(list);
        })
        .catch(() => {})
        .finally(() => (inFlight = false));
    };
    // A beacon survives tab close and full navigation; a server action started on pagehide is usually cancelled.
    const leave = () =>
      navigator.sendBeacon?.(`/api/incidents/${encodeURIComponent(incidentId)}/presence/leave`);
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('pagehide', leave);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [incidentId]);

  const others = viewers.filter(viewer => viewer.id !== currentUserId);
  if (!others.length) return null;
  const names = others.slice(0, NAMED).map(viewer => viewer.name || 'Someone');
  const label = `${names.join(', ')}${others.length > NAMED ? ` and ${others.length - NAMED} more` : ''} viewing now`;
  const extra = others.length - SHOWN;

  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={label}>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-ok" />
      <span aria-hidden className="flex -space-x-1.5">
        {others.slice(0, SHOWN).map(viewer => (
          <UserAvatar
            key={viewer.id}
            userId={viewer.id}
            name={viewer.name}
            avatarUrl={viewer.avatarUrl}
            size="xs"
            aria-hidden
            className="ring-2 ring-background"
          />
        ))}
      </span>
      {extra > 0 && (
        <span aria-hidden className="text-2xs font-medium tabular-nums">
          +{extra}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </p>
  );
}
