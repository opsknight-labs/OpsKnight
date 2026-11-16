'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function TeamsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Teams] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="w-full px-4 py-12 flex justify-center">
      <div className="max-w-lg w-full rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center space-y-4 dark:border-rose-500/30 dark:bg-rose-500/10">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center dark:bg-rose-500/15">
          <AlertCircle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Teams couldn&apos;t load</h2>
          <p className="text-sm text-ink-600 mt-1">{getUserFacingErrorMessage(error)}</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 transition"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
