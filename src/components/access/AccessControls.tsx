'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
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
  requestKind = 'TEAM_MEMBERSHIP',
  roleManagedExternally = false,
}: {
  requestId: string;
  requestedDuration: number | null;
  isOwnRequest: boolean;
  requestKind?: string;
  /** The requester's role comes from SSO/SCIM: only temporary role grants are possible. */
  roleManagedExternally?: boolean;
}) {
  const temporaryOnly = requestKind === 'ORG_ROLE' && roleManagedExternally;
  const durationChoices = temporaryOnly
    ? DURATION_OPTIONS.filter(option => option.value !== 'permanent')
    : DURATION_OPTIONS;
  const router = useRouter();
  const [duration, setDuration] = useState(
    requestedDuration ? String(requestedDuration) : temporaryOnly ? '480' : 'permanent'
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
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        This is your request. Someone else must review it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`duration-${requestId}`} className="text-xs text-muted-foreground">
            Grant for
          </Label>
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger id={`duration-${requestId}`} className="h-9 bg-background text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durationChoices.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`note-${requestId}`} className="text-xs text-muted-foreground">
            Note to requester (optional)
          </Label>
          <Input
            id={`note-${requestId}`}
            placeholder="Visible to the requester"
            value={note}
            maxLength={500}
            onChange={event => setNote(event.target.value)}
            className="h-9 bg-background text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => decide(false)}
            className="h-9 flex-1 gap-1.5 sm:flex-none"
          >
            <X className="h-4 w-4" aria-hidden />
            Decline
          </Button>
          <Button
            disabled={pending}
            onClick={() => decide(true)}
            className="h-9 flex-1 gap-1.5 sm:flex-none"
          >
            <Check className="h-4 w-4" aria-hidden />
            {pending ? 'Saving…' : 'Approve'}
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-xs text-rose-600 dark:text-rose-400"
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
