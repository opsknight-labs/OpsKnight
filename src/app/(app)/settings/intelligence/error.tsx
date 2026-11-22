'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

/**
 * Shared by every Intelligence settings page. Intelligence is optional, so a failure here is reported
 * plainly and never takes the rest of Settings with it.
 */
export default function IntelligenceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Intelligence] Settings page failed to render', {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      title="This Intelligence page couldn't load"
      message={`${getUserFacingErrorMessage(error)} Paging and escalation are not affected.`}
      errorCode={error.digest}
      onRetry={reset}
      backHref="/settings/intelligence"
      backLabel="Back to Intelligence"
    />
  );
}
