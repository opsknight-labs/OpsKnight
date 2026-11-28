'use client';

import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { notify } from '@/lib/toast';

/**
 * Native controls styled like the shadcn `Input` (same height, border, radius and focus ring), for the
 * server-action forms whose `<select>`/`<input>` post straight into `FormData`. 44 px tall and 16 px
 * text on phones (no iOS zoom), compact from `sm` up.
 */
export const fieldClass =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive sm:min-h-10 md:text-sm';
export const labelClass = 'text-sm font-medium';

/**
 * Result of a server action. Success is a toast plus a polite status region that is always mounted
 * (screen readers do not reliably announce a region inserted already holding its text). Failures stay
 * inline next to the form as `role="alert"`, so the user sees what to fix where they are.
 */
export function ActionMessage({ state }: { state: { message: string; ok: boolean } }) {
  const success = state.ok && state.message ? state.message : '';
  const failure = !state.ok && state.message ? state.message : '';
  const toasted = useRef<typeof state | null>(null);
  useEffect(() => {
    // Each submission returns a new state object; toast it once.
    if (!success || toasted.current === state) return;
    toasted.current = state;
    notify.success(success);
  }, [state, success]);
  // A conflict ("changed since you opened the page") or a failed save is fixed by reloading: offer it.
  const stale = /refresh|reload/i.test(failure);
  return (
    <>
      {/* Always mounted so screen readers announce it, and visible so a save is never easy to miss. */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={success ? 'flex items-center gap-1.5 text-sm text-muted-foreground' : 'sr-only'}
      >
        {success && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {success}
      </p>
      {failure && (
        <p role="alert" className="flex flex-wrap items-center gap-x-3 text-sm text-destructive">
          <span>{failure}</span>
          {stale && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 rounded-md px-2 font-medium underline sm:min-h-8"
            >
              Reload the page
            </button>
          )}
        </p>
      )}
    </>
  );
}

/**
 * Shown to people who can read a settings page but not change it. Controls stay visible so they can see how
 * it is set up; this says why they do nothing and who can change it.
 */
export function ViewOnlyNotice({ what = 'these settings' }: { what?: string }) {
  return (
    <p role="note" className="rounded-md border border-border bg-muted p-3 text-sm text-foreground">
      You can look at {what} but not change them. Ask an administrator to make a change.
    </p>
  );
}
