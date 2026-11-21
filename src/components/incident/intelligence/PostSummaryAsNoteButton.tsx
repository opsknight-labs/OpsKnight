'use client';

import { useState, useTransition } from 'react';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import type { IncidentSummary } from '@/lib/intelligence/drafts/schemas';
import {
  postSummaryAsNoteAction,
  type IncidentNoiseActionState,
} from '@/app/(app)/incidents/[id]/noise-actions';

/**
 * Posts the summary currently on screen as an incident note, through the normal note command. Once posted
 * for a given summary the button turns into a confirmation, so a double click cannot post twice.
 */
export default function PostSummaryAsNoteButton({
  incidentId,
  summary,
  model,
}: {
  incidentId: string;
  summary: IncidentSummary;
  model?: string | null;
}) {
  const [state, setState] = useState<IncidentNoiseActionState & { for?: IncidentSummary }>({
    ok: true,
    message: '',
  });
  const [pending, startTransition] = useTransition();
  const posted = state.done && state.for === summary;

  const post = () =>
    startTransition(async () => {
      const result = await postSummaryAsNoteAction(incidentId, { summary, model: model ?? null });
      setState({ ...result, for: summary });
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!posted && (
        <button
          type="button"
          onClick={post}
          disabled={pending}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-8"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Post summary as note
        </button>
      )}
      <p
        role={state.ok ? 'status' : 'alert'}
        aria-live="polite"
        className={state.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
      >
        {state.message}
      </p>
    </div>
  );
}
