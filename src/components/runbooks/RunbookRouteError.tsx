'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

export function RunbookRouteError({
  error,
  reset,
  title,
  backHref = '/runbooks',
  backLabel = 'Back to runbooks',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  backHref?: string;
  backLabel?: string;
}) {
  useEffect(() => {
    logger.error('[Runbooks] Render error', {
      message: error.message,
      name: error.name,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorState
      title={title}
      message={getUserFacingErrorMessage(error)}
      errorCode={error.digest}
      details={error?.message ? `${error.name}: ${error.message}` : undefined}
      onRetry={reset}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
