'use client';

import { useId, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { formatDateTime } from '@/lib/timezone';
import { toneClasses } from '@/components/patterns/status-tone';
import { isActive, type BackgroundTurn } from './background-turns';

const STATUS_TEXT: Record<BackgroundTurn['status'], string> = {
  QUEUED: 'Waiting to start',
  RUNNING: 'Working on it…',
  DONE: 'Ready',
  FAILED: 'Could not finish',
  CANCELLED: 'Cancelled',
};

/**
 * Answers working (or finished) in the background, as a strip under the header: counts first, the list on
 * demand. Finished answers open their conversation; running ones can be cancelled.
 */
export default function SquireBackgroundAnswers({
  turns,
  readyIds,
  timeZone,
  onOpen,
  onCancel,
}: {
  turns: BackgroundTurn[];
  readyIds: ReadonlySet<string>;
  timeZone: string;
  onOpen: (turn: BackgroundTurn) => void;
  onCancel: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const shown = turns.filter(turn => turn.status !== 'CANCELLED');
  if (shown.length === 0) return null;
  const working = shown.filter(isActive).length;
  const ready = shown.filter(turn => readyIds.has(turn.id)).length;
  const ok = toneClasses('ok');

  return (
    <section
      aria-label="Background answers"
      className="shrink-0 border-b border-border bg-muted/30 px-3 py-1 text-xs"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(value => !value)}
        className="flex min-h-11 w-full items-center gap-2 rounded text-left font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
      >
        {working > 0 && (
          <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
        )}
        <span className="flex-1">Background answers</span>
        {working > 0 && (
          <span className="rounded-full border border-border bg-card px-2 py-0.5">
            {working} working
          </span>
        )}
        {ready > 0 && (
          <span className={`rounded-full border px-2 py-0.5 ${ok.soft}`}>{ready} ready</span>
        )}
        <ChevronDown
          className={`h-4 w-4 motion-safe:transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <span className="sr-only" role="status">
        {ready > 0 ? `${ready} background ${ready === 1 ? 'answer is' : 'answers are'} ready` : ''}
      </span>
      {expanded && (
        <ul
          id={listId}
          className="mt-1 divide-y divide-border rounded-md border border-border bg-card"
        >
          {shown.map(turn => (
            <li key={turn.id} className="flex items-center gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">{turn.title}</span>
                <span
                  className={`block ${turn.status === 'FAILED' ? toneClasses('critical').text : 'text-muted-foreground'}`}
                >
                  {turn.status === 'FAILED' && turn.failure
                    ? turn.failure
                    : STATUS_TEXT[turn.status]}
                  {turn.completedAt && turn.status === 'DONE'
                    ? ` · ${formatDateTime(turn.completedAt, timeZone)}`
                    : ''}
                </span>
              </div>
              {isActive(turn) ? (
                <button
                  type="button"
                  onClick={() => onCancel(turn.id)}
                  aria-label={`Cancel background answer: ${turn.title}`}
                  className="min-h-11 rounded px-2 underline-offset-2 hover:underline sm:min-h-8"
                >
                  Cancel
                </button>
              ) : turn.conversationId ? (
                <button
                  type="button"
                  onClick={() => onOpen(turn)}
                  aria-label={`Open answer: ${turn.title}`}
                  className="min-h-11 rounded px-2 font-medium underline-offset-2 hover:underline sm:min-h-8"
                >
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
