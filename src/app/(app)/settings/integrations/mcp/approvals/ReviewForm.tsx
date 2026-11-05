'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/shadcn/button';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { mcpHref } from '../list-params';
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
      <Button
        type="submit"
        name="decision"
        value="reject"
        formNoValidate
        disabled={pending}
        variant="outline"
        size="lg"
      >
        {choice === 'reject' ? 'Rejecting…' : rejectLabel}
      </Button>
      {freshSignInRequired ? (
        // A stale sign-in cannot approve a destructive change; sign in again and come back here.
        <Button
          type="button"
          size="lg"
          disabled={pending}
          onClick={() =>
            signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(reviewPath)}` })
          }
        >
          Confirm it&apos;s you to approve
        </Button>
      ) : (
        <Button
          type="submit"
          name="decision"
          value="approve"
          size="lg"
          disabled={pending}
          aria-label={`${approveLabel} (${noun})`}
        >
          {choice === 'approve' ? 'Approving…' : approveLabel}
        </Button>
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
      <InlineNotice
        tone="success"
        title={
          result.decision === 'approve'
            ? `You approved this ${noun}.`
            : `You rejected this ${noun}.`
        }
      >
        <p className="text-sm">
          {selfReview ? '' : 'The requester was notified in OpsKnight. '}
          {result.decision === 'approve'
            ? `${selfReview ? 'Your' : 'Their'} assistant can now apply it once.`
            : 'Nothing was changed.'}
        </p>
        <Link
          href={mcpHref({ tab: 'approvals' })}
          className="mt-2 inline-block text-sm font-medium underline underline-offset-4"
        >
          Back to approvals
        </Link>
      </InlineNotice>
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
        <InlineNotice tone="error" urgency="assertive">
          <p className="text-sm">{reviewMessage(result.code)}</p>
        </InlineNotice>
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
