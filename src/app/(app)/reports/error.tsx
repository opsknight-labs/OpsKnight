'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { purgeCachesAndReload } from '@/components/ChunkLoadErrorHandler';
import { logger } from '@/lib/logger';
import { isChunkLoadError, toUserFacingError } from '@/lib/user-facing-error';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Reports] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  const userFacing = toUserFacingError(error);

  if (isChunkLoadError(error)) {
    return (
      <ErrorState
        title="Application update available"
        message={userFacing.description}
        onRetry={() => purgeCachesAndReload()}
        retryText="Reload page"
        onGoBack={reset}
        backLabel="Try again"
      />
    );
  }

  return (
    <ErrorState
      title="Reports couldn't load"
      message={userFacing.title}
      errorCode={error.digest}
      onRetry={reset}
      backHref="/"
      backLabel="Go to dashboard"
    />
  );
}
