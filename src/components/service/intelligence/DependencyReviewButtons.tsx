'use client';

import { useActionState } from 'react';
import {
  reviewServiceDependencyAction,
  type DependencyReviewState,
} from '@/app/(app)/services/[id]/intelligence/actions';
import { Button } from '@/components/ui/shadcn/button';

/**
 * Approve / reject for one observed-dependency suggestion. Both buttons post to the same server action;
 * the result is announced next to them and the server re-renders the graph.
 */
export default function DependencyReviewButtons({
  serviceId,
  dependencyId,
  label,
}: {
  serviceId: string;
  dependencyId: string;
  /** What is being reviewed, for the buttons' accessible names (e.g. "Checkout depends on Payments"). */
  label: string;
}) {
  const [state, formAction, pending] = useActionState<DependencyReviewState, FormData>(
    reviewServiceDependencyAction,
    null
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="dependencyId" value={dependencyId} />
      <Button
        type="submit"
        name="decision"
        value="APPROVE"
        size="sm"
        variant="outline"
        disabled={pending}
        className="min-h-11 sm:min-h-9"
        aria-label={`Approve suggested dependency: ${label}`}
      >
        Approve
      </Button>
      <Button
        type="submit"
        name="decision"
        value="REJECT"
        size="sm"
        variant="ghost"
        disabled={pending}
        className="min-h-11 sm:min-h-9"
        aria-label={`Reject suggested dependency: ${label}`}
      >
        Reject
      </Button>
      {state?.message && (
        <span
          role={state.ok ? 'status' : 'alert'}
          className={state.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
