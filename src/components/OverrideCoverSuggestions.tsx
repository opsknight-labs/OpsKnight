'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Moon, Sparkles, Sun } from 'lucide-react';
import { suggestOverrideCover } from '@/app/(app)/schedules/cover-actions';
import type { CoverSuggestions } from '@/lib/intelligence/people/cover';
import { cn } from '@/lib/utils';

/**
 * Ranked cover candidates under the override window. Asks once the window is valid (debounced) and renders
 * nothing unless the window has a gap or replaces someone and there is somebody to suggest.
 */
export default function OverrideCoverSuggestions({
  scheduleId,
  start,
  end,
  replacesUserId,
  selectedUserId,
  onPick,
}: {
  scheduleId: string;
  start: Date | null;
  end: Date | null;
  replacesUserId: string | null;
  selectedUserId: string;
  onPick: (userId: string) => void;
}) {
  const titleId = useId();
  const startIso = start?.toISOString() ?? null;
  const endIso = end?.toISOString() ?? null;
  // Answers are keyed by the request, so a changed window never shows the previous window's people.
  const requestKey = `${scheduleId}|${startIso}|${endIso}|${replacesUserId}`;
  const [answer, setAnswer] = useState<{ key: string; result: CoverSuggestions | null } | null>(
    null
  );
  const result = answer?.key === requestKey ? answer.result : null;

  useEffect(() => {
    if (!startIso || !endIso || endIso <= startIso) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      suggestOverrideCover({ scheduleId, start: startIso, end: endIso, replacesUserId })
        .then(next => {
          if (!cancelled) setAnswer({ key: requestKey, result: next });
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scheduleId, startIso, endIso, replacesUserId, requestKey]);

  if (!result || result.candidates.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <h3
          id={titleId}
          className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          Suggested cover
        </h3>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        {result.gap ? 'Part of this window has nobody on call. ' : ''}
        Not on call then; lightest load over the last {result.windowDays} days first.
      </p>
      <ul className="mt-2 space-y-1">
        {result.candidates.map(candidate => {
          const picked = candidate.userId === selectedUserId;
          return (
            <li key={candidate.userId}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() => onPick(candidate.userId)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  picked ? 'border-primary bg-primary/5' : 'bg-background hover:border-primary/50'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{candidate.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {candidate.daytime ? (
                      <Sun className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <Moon className="h-3 w-3" aria-hidden="true" />
                    )}
                    {candidate.daytime ? 'Daytime for them' : 'Outside 08:00-22:00 for them'}
                    {candidate.pages !== null &&
                      ` · ${candidate.pages} pages, ${candidate.nightPages} at night`}
                  </span>
                </span>
                {picked && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
