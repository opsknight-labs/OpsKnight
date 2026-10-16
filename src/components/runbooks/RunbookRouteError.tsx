'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
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
    });
  }, [error]);

  return (
    <div className="flex w-full justify-center px-4 py-12">
      <div
        role="alert"
        className="w-full max-w-lg space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{getUserFacingErrorMessage(error)}</p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
