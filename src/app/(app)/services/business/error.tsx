'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function BusinessServicesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[BusinessServices] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div role="alert" className="flex w-full justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center dark:border-rose-500/30 dark:bg-rose-500/10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/15">
          <AlertCircle className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            Business services couldn&apos;t load
          </h2>
          <p className="mt-1 text-sm text-ink-600">{getUserFacingErrorMessage(error)}</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
