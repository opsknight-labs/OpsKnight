'use client';

import { useEffect, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ErrorState from '@/components/patterns/ErrorState';
import { logger } from '@/lib/logger';

/** Detail routes go back to their list; list routes go back to home. */
function parentRoute(pathname: string): { href: string; label: string } {
  const [, root, section, id] = pathname.split('/');
  if (root === 'm' && section && id) {
    return { href: `/m/${section}`, label: 'Back to list' };
  }
  return { href: '/m', label: 'Back to home' };
}

/**
 * Route-level error boundary body for /m. Names what failed, retries the segment and
 * offers a way back. Used by every `error.tsx` under `src/app/(mobile)/m`.
 */
export function MobileRouteError({
  error,
  reset,
  title = 'This page could not load',
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const parent = parentRoute(usePathname() || '/m');
  const [isRetrying, startRetry] = useTransition();

  useEffect(() => {
    logger.error('mobile.routeError', { error, digest: error.digest, title });
  }, [error, title]);

  return (
    <div className="responsive-page">
      <ErrorState
        title={title}
        message="Check your connection and try again. Incident actions on other screens keep working."
        errorCode={error.digest}
        onRetry={() =>
          startRetry(() => {
            router.refresh();
            reset();
          })
        }
        isRetrying={isRetrying}
        backHref={backHref ?? parent.href}
        backLabel={backLabel ?? parent.label}
        className="min-h-[60vh] px-2 py-8"
      />
    </div>
  );
}

/**
 * Inline "data unavailable" state for server snapshots (home, analytics, system health).
 * Unknown metrics are hidden rather than shown as zero; Retry re-runs the server render.
 */
export function MobileUnavailableState({
  title,
  message,
  backHref,
  backLabel,
}: {
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const [isRetrying, startRetry] = useTransition();

  return (
    <ErrorState
      variant="inline"
      title={title}
      message={message}
      onRetry={() => startRetry(() => router.refresh())}
      isRetrying={isRetrying}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
