'use client';

import { useState, useTransition } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { summarizeIncidentAction, type IncidentSummaryState } from '@/app/(app)/incidents/[id]/intelligence-actions';

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Generated on request and shown only to the person who asked; it is plain text and never saved. */
export default function IncidentAiSummary({ incidentId }: { incidentId: string }) {
  const [state, setState] = useState<IncidentSummaryState>({ status: 'idle' });
  const [pending, startTransition] = useTransition();

  const generate = () =>
    startTransition(async () => {
      setState(await summarizeIncidentAction(incidentId));
    });

  return (
    <section aria-labelledby="ai-summary-heading" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="ai-summary-heading" className="text-sm font-semibold">
            AI summary
          </h2>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {state.status === 'ok' ? 'Regenerate' : 'Summarise this incident'}
        </button>
      </div>
      <div aria-live="polite" aria-busy={pending}>
        {state.status === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
        {state.status === 'ok' && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{state.summary.headline}</p>
            <p className="text-sm">{state.summary.currentState}</p>
            {state.summary.impact && <p className="text-sm text-foreground/80">Impact: {state.summary.impact}</p>}
            <List title="Key events" items={state.summary.keyEvents} />
            <List title="Possible causes (to verify)" items={state.summary.possibleCauses} />
            <List title="Suggested next steps" items={state.summary.nextSteps} />
            <p className="text-xs text-foreground/70">AI-generated from the incident record. Check it before relying on it. Nothing was changed.</p>
          </div>
        )}
        {state.status === 'idle' && !pending && (
          <p className="text-xs text-foreground/70">Get a short catch-up written from the timeline, notes and suggestions you can see.</p>
        )}
      </div>
    </section>
  );
}
