'use client';

import ErrorBoundary from '@/components/ui/ErrorBoundary';
import ErrorState from '@/components/ui/ErrorState';
import { logger } from '@/lib/logger';
import { captureException, isSentryEnabled } from '@/lib/monitoring/sentry';

/**
 * Global error boundary wrapper for the app
 * Wraps the entire application to catch and handle errors
 */
export default function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <ErrorState
          title="Application Error"
          message="Something went wrong. Please refresh the page or contact support if the problem persists."
          onRetry={() => window.location.reload()}
        />
      }
      onError={(error, errorInfo) => {
        // JS Error has non-enumerable `message`/`stack` properties that
        // JSON.stringify silently drops — explicitly extract them so the
        // server-side log actually carries the diagnostic payload.
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorName = error instanceof Error ? error.name : 'UnknownError';

        logger.error('Application error', {
          component: 'error-boundary',
          errorName,
          errorMessage,
          errorStack,
          componentStack: errorInfo?.componentStack,
        });

        if (isSentryEnabled()) {
          captureException(error, {
            component: 'error-boundary',
            extra: {
              componentStack: errorInfo?.componentStack,
            },
          });
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
