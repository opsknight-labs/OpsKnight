'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

export default function PoliciesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Policies] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      title="Escalation policies couldn't load"
      message={getUserFacingErrorMessage(error)}
      errorCode={error.digest}
      onRetry={reset}
      backHref="/"
      backLabel="Go to dashboard"
    />
  );
}
