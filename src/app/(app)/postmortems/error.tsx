'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

export default function PostmortemsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Postmortems] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      title="Postmortems couldn't load"
      message={getUserFacingErrorMessage(error)}
      errorCode={error.digest}
      onRetry={reset}
      backHref="/"
      backLabel="Go to dashboard"
    />
  );
}
