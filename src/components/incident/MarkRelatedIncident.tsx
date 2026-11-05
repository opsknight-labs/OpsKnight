'use client';
import { useActionState } from 'react';
import { markIncidentRelated } from '@/app/(app)/incidents/[id]/intelligence-actions';

export default function MarkRelatedIncident({
  incidentId,
  otherIncidentId,
}: {
  incidentId: string;
  otherIncidentId: string;
}) {
  const [state, action, pending] = useActionState(
    markIncidentRelated.bind(null, incidentId, otherIncidentId),
    { ok: false, message: '' }
  );
  return (
    <form action={action} className="space-y-1">
      <button
        type="submit"
        disabled={pending || state.ok}
        className="min-h-9 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50"
      >
        {state.ok ? 'Marked related' : 'Mark related'}
      </button>
      {state.message && (
        <p role={state.ok ? 'status' : 'alert'} className="text-xs text-muted-foreground">
          {state.message}
        </p>
      )}
    </form>
  );
}
