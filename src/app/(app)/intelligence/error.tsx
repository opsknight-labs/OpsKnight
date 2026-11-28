'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

/** The overview is advisory: a failure is reported plainly and never affects paging. */
export default function IntelligenceOverviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Intelligence] Overview failed to render', {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      variant="page"
      title="The Intelligence overview couldn't load"
      message={<>{getUserFacingErrorMessage(error)} Paging and escalation are not affected.</>}
      errorCode={error.digest}
      onRetry={reset}
      backHref="/"
      backLabel="Go to dashboard"
    />
  );
}
