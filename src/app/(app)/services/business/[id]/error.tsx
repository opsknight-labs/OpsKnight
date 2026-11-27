'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

export default function BusinessServiceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    logger.error('[BusinessService] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      title="This business service couldn't load"
      message={getUserFacingErrorMessage(error)}
      errorCode={error.digest}
      onRetry={() =>
        // Re-fetch the server data too: reset alone re-renders with the payload that failed.
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
      backHref="/services/business"
      backLabel="Back to business services"
    />
  );
}
