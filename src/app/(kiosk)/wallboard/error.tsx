'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

/** Stays dark like the board itself, so a NOC screen never flashes white. */
export default function WallboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Wallboard] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="dark fixed inset-0 z-[70] flex items-center justify-center bg-[#050507] p-6 text-foreground">
      <ErrorState
        title="The wallboard couldn't load"
        message={getUserFacingErrorMessage(error)}
        errorCode={error.digest}
        onRetry={reset}
        backHref="/"
        backLabel="Open the console"
      />
    </div>
  );
}
