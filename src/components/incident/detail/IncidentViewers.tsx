'use client';

import { useEffect, useState } from 'react';
import UserAvatar from '@/components/UserAvatar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';
import { cn } from '@/lib/utils';
import { CHIP_CLASS } from '../field-styles';
import type { PresenceViewer } from '@/lib/incidents/presence';
import { heartbeatIncidentPresence } from '../presence-actions';

const BEAT_MS = 30_000;
/** Never beat more often than this, however often the tab flips visible. */
const MIN_GAP_MS = 20_000;
const SHOWN = 3;

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
  // Controlled so a tap opens it too (touch has no hover, and iOS does not focus buttons on tap).
  const [open, setOpen] = useState(false);

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
  const nameOf = (viewer: PresenceViewer) => viewer.name?.trim() || 'Someone';
  const short =
    others.length === 1
      ? `${nameOf(others[0]).split(/\s+/)[0]} viewing`
      : `${others.length} viewing`;
  const label = `Viewing now: ${others.map(nameOf).join(', ')}`;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => setOpen(value => !value)}
          className={cn(CHIP_CLASS, 'cursor-default text-muted-foreground hover:bg-muted/60')}
        >
          <span aria-hidden className="flex -space-x-1.5">
            {others.slice(0, SHOWN).map(viewer => (
              <UserAvatar
                key={viewer.id}
                userId={viewer.id}
                name={viewer.name}
                avatarUrl={viewer.avatarUrl}
                size="xs"
                className="ring-2 ring-background"
              />
            ))}
          </span>
          <span aria-hidden className="max-w-28 truncate text-foreground">
            {short}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-64 max-w-[calc(100vw-2rem)] p-0">
        <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Viewing now · {others.length}
        </p>
        <ul className="max-h-64 overflow-y-auto py-1">
          {others.map(viewer => (
            <li key={viewer.id} className="flex items-center gap-2 px-3 py-1.5">
              <UserAvatar
                userId={viewer.id}
                name={viewer.name}
                avatarUrl={viewer.avatarUrl}
                size="xs"
              />
              <span className="min-w-0 truncate text-sm text-foreground">{nameOf(viewer)}</span>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
