'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { signOut } from 'next-auth/react';
import { reviewMessage, type ReviewResult } from './review-result';

type ReviewAction = (previous: ReviewResult | null, form: FormData) => Promise<ReviewResult>;

function Buttons({
  noun,
  approveLabel,
  rejectLabel,
  freshSignInRequired,
  reviewPath,
}: {
  noun: string;
  approveLabel: string;
  rejectLabel: string;
  freshSignInRequired: boolean;
  reviewPath: string;
}) {
  const { pending, data } = useFormStatus();
  const choice = pending ? data?.get('decision') : null;
  return (
    <div className="flex flex-wrap gap-4" aria-busy={pending}>
      <button
        type="submit"
        name="decision"
        value="reject"
        formNoValidate
        disabled={pending}
        className="rounded border px-4 py-3 disabled:opacity-60"
      >
        {choice === 'reject' ? 'Rejecting…' : rejectLabel}
      </button>
      {freshSignInRequired ? (
        // A stale sign-in cannot approve a destructive change; sign in again and come back here.
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(reviewPath)}` })
          }
          className="rounded bg-primary px-4 py-3 text-primary-foreground disabled:opacity-60"
        >
          Confirm it&apos;s you to approve
        </button>
      ) : (
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          aria-label={`${approveLabel} (${noun})`}
          className="rounded bg-primary px-4 py-3 text-primary-foreground disabled:opacity-60"
        >
          {choice === 'approve' ? 'Approving…' : approveLabel}
        </button>
      )}
    </div>
  );
}

/** Review decision form: shows refusals inline instead of an error page. */
export default function ReviewForm({
  action,
  hidden,
  noun,
  approveLabel,
  rejectLabel,
  freshSignInRequired = false,
  selfReview = false,
  reviewPath,
  children,
}: {
  action: ReviewAction;
  hidden: Record<string, string>;
  noun: string;
  approveLabel: string;
  rejectLabel: string;
  freshSignInRequired?: boolean;
  /** The reviewer is the requester, who is not sent a notice about their own decision. */
  selfReview?: boolean;
  reviewPath: string;
  children?: ReactNode;
}) {
  const [result, formAction] = useActionState(action, null);
  if (result?.ok)
    return (
      <div
        role="status"
        className="rounded border border-emerald-300 bg-emerald-50 p-4 text-emerald-900"
      >
        <p className="font-medium">
          {result.decision === 'approve'
            ? `You approved this ${noun}.`
            : `You rejected this ${noun}.`}
        </p>
        <p className="mt-1 text-sm">
          {selfReview ? '' : 'The requester was notified in OpsKnight. '}
          {result.decision === 'approve'
            ? `${selfReview ? 'Your' : 'Their'} assistant can now apply it once.`
            : 'Nothing was changed.'}
        </p>
      </div>
    );
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="space-y-1.5">
        <label htmlFor="review-reason" className="block text-sm font-medium">
          Note to the requester (optional)
        </label>
        <textarea
          id="review-reason"
          name="reason"
          maxLength={500}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="For example: wrong service, or do this after the freeze"
        />
        <p className="text-xs text-muted-foreground">
          Shown to the requester and their assistant. Up to 500 characters.
        </p>
      </div>
      {result && !result.ok && (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-amber-900"
        >
          <p className="text-sm">{reviewMessage(result.code)}</p>
        </div>
      )}
      <Buttons
        noun={noun}
        approveLabel={approveLabel}
        rejectLabel={rejectLabel}
        freshSignInRequired={freshSignInRequired}
        reviewPath={reviewPath}
      />
    </form>
  );
}
