'use client';

import { useActionState } from 'react';
import {
  decideRelatedIncident,
  type RelatedDecisionState,
} from '@/app/(app)/incidents/[id]/intelligence-actions';

/** Confirm / not related / undo for one related-incident link. */
export default function RelatedIncidentActions({
  incidentId,
  relationshipId,
  decision,
}: {
  incidentId: string;
  relationshipId: string;
  decision: 'SUGGESTED' | 'ACCEPTED';
}) {
  const [state, action, pending] = useActionState<RelatedDecisionState, FormData>(
    decideRelatedIncident.bind(null, incidentId),
    { ok: true, message: '', decision }
  );
  const current = state.decision;
  const button = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50';

  const form = (next: 'ACCEPTED' | 'REJECTED' | 'REVERTED', label: string) => (
    <form action={action}>
      <input type="hidden" name="relationshipId" value={relationshipId} />
      <input type="hidden" name="decision" value={next} />
      <button type="submit" disabled={pending} className={button}>
        {label}
      </button>
    </form>
  );

  if (current === 'REJECTED' || current === 'REVERTED') {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {state.message || 'Link removed.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1" aria-live="polite">
      <div className="flex items-center gap-1">
        {current === 'SUGGESTED' ? (
          <>
            {form('ACCEPTED', 'Related')}
            {form('REJECTED', 'Not related')}
          </>
        ) : (
          form('REVERTED', 'Unlink')
        )}
      </div>
      {!state.ok && state.message && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}
