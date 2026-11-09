'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import {
  reverseIncidentNoiseDecision,
  type IncidentNoiseActionState,
} from '@/app/(app)/incidents/[id]/noise-actions';
import { decideRelatedIncident } from '@/app/(app)/incidents/[id]/intelligence-actions';

export type UngroupTarget =
  { type: 'decision'; decisionId: string } | { type: 'relationship'; relationshipId: string };

/**
 * One confirm-first control for every "take this out of the noise layer" action on the incident page:
 * releasing a grouped or suppressed alert (noise-control reversal, which re-ingests it so it pages) or
 * removing a child incident from its group (relationship decision). The server re-checks permission.
 */
export default function UngroupButton({
  incidentId,
  target,
  label,
  confirmTitle,
  confirmBody,
  confirmLabel,
}: {
  incidentId: string;
  target: UngroupTarget;
  label: string;
  confirmTitle: string;
  confirmBody: string;
  confirmLabel?: string;
}) {
  const [state, setState] = useState<IncidentNoiseActionState>({ ok: true, message: '' });
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      if (target.type === 'decision') {
        const form = new FormData();
        form.set('decisionId', target.decisionId);
        setState(await reverseIncidentNoiseDecision(incidentId, state, form));
      } else {
        const form = new FormData();
        form.set('relationshipId', target.relationshipId);
        form.set('decision', 'REVERTED');
        const result = await decideRelatedIncident(
          incidentId,
          { ok: true, message: '', decision: 'ACCEPTED' },
          form
        );
        setState({
          ok: result.ok,
          done: result.ok,
          message: result.ok ? 'Removed from the group.' : result.message,
        });
      }
    });

  return (
    <div className="flex flex-col items-end gap-1">
      {!state.done && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-8"
            >
              {pending && (
                <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
              )}
              {label}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={run}>{confirmLabel ?? label}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <p
        role={state.ok ? 'status' : 'alert'}
        aria-live="polite"
        className={state.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
      >
        {state.message}
        {state.pagedIncidentId && (
          <>
            {' '}
            <Link href={`/incidents/${state.pagedIncidentId}`} className="underline">
              Open the new incident
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
