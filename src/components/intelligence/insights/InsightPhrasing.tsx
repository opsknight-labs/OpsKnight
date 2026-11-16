'use client';

import { useId, useState, useTransition } from 'react';
import { phraseInsightsAction } from '@/app/(app)/intelligence/insight-actions';
import type { OpsInsightScope } from '@/lib/intelligence/ops-insights/contract';
import type { InsightPhrasing as Phrasing } from '@/lib/intelligence/ops-insights/phrasing';

/**
 * "In plain words" disclosure under an insights list. Collapsed it costs nothing; the first expand asks the
 * server for one phrasing of the whole scope (cached there), later toggles reuse the answer.
 */
export default function InsightPhrasing({
  scope,
  titles,
}: {
  scope: OpsInsightScope;
  /** Insight id to title, in display order, so each phrase sits under the insight it rewrites. */
  titles: ReadonlyArray<readonly [string, string]>;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Phrasing | null>(null);
  const [pending, startTransition] = useTransition();
  const regionId = useId();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !result && !pending)
      startTransition(async () => setResult(await phraseInsightsAction(scope)));
  };

  const phrases = new Map(Object.entries(result?.phrases ?? {}));
  const phrased = titles.flatMap(([id, title]) => {
    const text = phrases.get(id);
    return text ? [{ id, title, text }] : [];
  });
  return (
    <div className="pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={toggle}
        className="inline-flex min-h-11 items-center rounded-md px-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
      >
        {open ? 'Hide plain-language version' : 'Explain in plain words'}
      </button>
      {open && (
        <div id={regionId} aria-live="polite" aria-busy={pending} className="space-y-2 pt-1">
          {pending && <p className="text-xs text-muted-foreground">Writing…</p>}
          {phrased.length > 0 && (
            <ul className="space-y-3">
              {phrased.map(({ id, title, text }) => (
                <li key={id} className="space-y-0.5">
                  <p className="break-words text-xs text-muted-foreground">{title}</p>
                  <p className="break-words text-sm">{text}</p>
                </li>
              ))}
            </ul>
          )}
          {result?.notice && <p className="text-xs text-muted-foreground">{result.notice}</p>}
          {phrased.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Written by AI from the facts above. Check them before acting.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
