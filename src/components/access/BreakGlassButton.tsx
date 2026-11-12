'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Siren } from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { activateBreakGlassAction } from '@/app/(app)/settings/access/actions';
import { signInAgain } from '@/components/access/SignInAgainButton';
import SimpleSelect from '@/components/access/SimpleSelect';

const OPTIONS = [15, 30, 60, 120, 240];

export default function BreakGlassButton({
  maxMinutes,
  incidentId,
  returnPath,
  size = 'sm',
}: {
  size?: 'sm' | 'default';
  maxMinutes: number;
  /** Scope the elevation to one incident. */
  incidentId?: string | null;
  returnPath: string;
}) {
  const router = useRouter();
  const choices = OPTIONS.filter(minutes => minutes <= maxMinutes);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(choices.includes(60) ? 60 : (choices.at(-1) ?? 15));
  const [error, setError] = useState<{ message: string; stepUp: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await activateBreakGlassAction({ reason, minutes, incidentId });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError({ message: result.error, stepUp: result.code === 'STEP_UP_REQUIRED' });
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        className="shrink-0 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
        onClick={() => setOpen(true)}
      >
        <Siren className="h-3.5 w-3.5" aria-hidden />
        Emergency access
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Siren className="h-5 w-5" aria-hidden />
            </div>
            <DialogTitle>Use emergency access?</DialogTitle>
            <DialogDescription>
              {incidentId
                ? 'You can open this incident and acknowledge, add notes, escalate and resolve it for a short time.'
                : 'You get temporary Responder access for a short time.'}{' '}
              Use this only when an incident can’t wait for an approver.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Every administrator is notified right away, and everything you do is recorded in the
              audit log.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="break-glass-reason">What is the emergency?</Label>
              <Textarea
                id="break-glass-reason"
                rows={3}
                value={reason}
                maxLength={1000}
                onChange={event => setReason(event.target.value)}
                placeholder="Checkout is down and the on-call responder is not answering."
              />
              <p className="text-xs text-muted-foreground">At least 10 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="break-glass-duration">Duration</Label>
              <SimpleSelect
                id="break-glass-duration"
                value={String(minutes)}
                onValueChange={value => setMinutes(Number(value))}
                options={choices.map(option => ({
                  value: String(option),
                  label:
                    option < 60
                      ? `${option} minutes`
                      : `${option / 60} hour${option === 60 ? '' : 's'}`,
                }))}
              />
            </div>
            {error && (
              <div role="alert" className="space-y-2 text-sm text-rose-600 dark:text-rose-400">
                <p>{error.message}</p>
                {error.stepUp && (
                  <Button size="sm" variant="outline" onClick={() => signInAgain(returnPath)}>
                    Sign in again
                  </Button>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={activate}
              disabled={pending || reason.trim().length < 10}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {pending ? 'Activating…' : 'Activate emergency access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
