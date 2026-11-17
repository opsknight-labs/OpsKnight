'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

export default function TeamDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Team Detail] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      title="This team couldn't load"
      message={getUserFacingErrorMessage(error)}
      errorCode={error.digest}
      onRetry={reset}
      backHref="/teams"
      backLabel="Back to teams"
    />
  );
}
