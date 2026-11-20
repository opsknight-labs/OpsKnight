'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/patterns';
import { logger } from '@/lib/logger';

/** Public status page render failure. Visitors get a retry, never a link into the console. */
export default function StatusPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[StatusPage] Render error', {
      message: error.message,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <ErrorState
        title="This status page couldn't load"
        message="We couldn't load the latest status right now. Try again in a moment."
        errorCode={error.digest}
        onRetry={reset}
      />
    </main>
  );
}
