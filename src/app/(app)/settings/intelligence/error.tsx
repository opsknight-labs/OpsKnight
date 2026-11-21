'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

/**
 * Shared by every Intelligence settings page. Intelligence is optional, so a failure here is reported
 * plainly and never takes the rest of Settings with it.
 */
export default function IntelligenceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logger.error('[Intelligence] Settings page failed to render', { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <div role="alert" className="flex justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">This Intelligence page couldn&apos;t load</h2>
          <p className="mt-1 text-sm text-muted-foreground">{getUserFacingErrorMessage(error)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Paging and escalation are not affected.</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    </div>
  );
}
