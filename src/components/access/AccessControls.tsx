'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  cancelAccessRequestAction,
  decideAccessRequestAction,
  revokeAccessGrantAction,
} from '@/app/(app)/settings/access/actions';
import { DURATION_OPTIONS } from '@/components/access/RequestAccessForm';
import { signInAgain } from '@/components/access/SignInAgainButton';

export function EndGrantButton({
  grantId,
  label = 'End now',
}: {
  grantId: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await revokeAccessGrantAction(grantId);
          router.refresh();
        })
      }
    >
      {pending ? 'Ending…' : label}
    </Button>
  );
}

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await cancelAccessRequestAction(requestId);
          router.refresh();
        })
      }
    >
      {pending ? 'Cancelling…' : 'Cancel'}
    </Button>
  );
}

/** Approve/decline controls with optional duration override and note. */
export function DecideRequestControls({
  requestId,
  requestedDuration,
  isOwnRequest,
}: {
  requestId: string;
  requestedDuration: number | null;
  isOwnRequest: boolean;
}) {
  const router = useRouter();
  const [duration, setDuration] = useState(
    requestedDuration ? String(requestedDuration) : 'permanent'
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ message: string; stepUp: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await decideAccessRequestAction(requestId, {
        approve,
        note,
        durationMinutes: duration === 'permanent' ? null : Number(duration),
      });
      if (result.ok) router.refresh();
      else setError({ message: result.error, stepUp: result.code === 'STEP_UP_REQUIRED' });
    });
  }

  if (isOwnRequest) {
    return (
      <p className="text-xs text-muted-foreground">
        This is your request. Someone else must review it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`duration-${requestId}`}>
          Grant for
        </label>
        <select
          id={`duration-${requestId}`}
          value={duration}
          onChange={event => setDuration(event.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {DURATION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Note to requester (optional)"
          placeholder="Note (optional)"
          value={note}
          maxLength={500}
          onChange={event => setNote(event.target.value)}
          className="h-8 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-xs"
        />
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
          Decline
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400"
        >
          <span>{error.message}</span>
          {error.stepUp && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => signInAgain('/settings/access/requests')}
            >
              Sign in again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
