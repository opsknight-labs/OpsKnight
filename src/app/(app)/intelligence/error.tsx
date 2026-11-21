'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

/** The overview is advisory: a failure is reported plainly and never affects paging. */
export default function IntelligenceOverviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Intelligence] Overview failed to render', {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div role="alert" className="flex justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">The AIOps overview couldn&apos;t load</h2>
          <p className="mt-1 text-sm text-muted-foreground">{getUserFacingErrorMessage(error)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Paging and escalation are not affected.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    </div>
  );
}
