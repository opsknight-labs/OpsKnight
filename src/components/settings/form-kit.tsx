'use client';

import { useEffect, useRef } from 'react';
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
  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {success}
      </p>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </>
  );
}
