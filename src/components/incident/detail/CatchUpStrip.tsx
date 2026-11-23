'use client';

import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';
import {
  countsLine,
  summarizeSince,
  type CatchUpItem,
  type CatchUpSummary,
} from '@/lib/incidents/catch-up';
import RelativeTime from '@/components/patterns/RelativeTime';

const KEY = (incidentId: string) => `opsknight.incident.seen.${incidentId}`;

function readSeen(incidentId: string): string | null {
  try {
    return window.localStorage.getItem(KEY(incidentId));
  } catch {
    return null;
  }
}

function writeSeen(incidentId: string) {
  try {
    window.localStorage.setItem(KEY(incidentId), new Date().toISOString());
  } catch {
    // private mode or blocked storage: catch-up simply does not show next time
  }
}

/**
 * "Since you looked 2h ago: escalated to step 3 · 4 alerts · 2 notes" — no AI, from the incident's own events.
 * Last visit is remembered per incident in this browser; nothing shows on a first visit.
 */
export default function CatchUpStrip({
  incidentId,
  items,
}: {
  incidentId: string;
  items: CatchUpItem[];
}) {
  const [state, setState] = useState<{ since: string; summary: CatchUpSummary } | null>(null);

  useEffect(() => {
    const since = readSeen(incidentId);
    // Read after mount (storage is browser-only), then remember this visit for next time.
    if (since) {
      const summary = summarizeSince(items, since);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the summary depends on browser storage
      if (summary.total > 0) setState({ since, summary });
    }
    writeSeen(incidentId);
    // Once per incident: a server refresh passes a new items array but is not a new visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  if (!state) return null;
  const counts = countsLine(state.summary.counts);
  return (
    <section
      aria-label="What changed since your last visit"
      className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border/80 bg-background px-3.5 py-2.5 text-xs shadow-2xs"
    >
      <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs text-foreground">
          <span className="font-semibold">Since you looked</span>{' '}
          <span className="text-muted-foreground">
            <RelativeTime date={new Date(state.since)} />:
          </span>{' '}
          {counts || `${state.summary.total} updates`}
        </p>
        {state.summary.highlights.map(text => (
          <p key={text} className="truncate text-xs text-muted-foreground" title={text}>
            {text}
          </p>
        ))}
      </div>
      <a
        href="#incident-activity"
        className="shrink-0 self-center text-xs font-semibold text-foreground underline-offset-2 hover:underline"
      >
        Timeline
      </a>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setState(null)}
        className="shrink-0 self-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </section>
  );
}
