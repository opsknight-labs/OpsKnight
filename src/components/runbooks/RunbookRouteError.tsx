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
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="flex w-full justify-center px-4 py-16">
      <div
        role="alert"
        className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-xs"
      >
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-inset ring-destructive/20">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
        </span>
        <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {getUserFacingErrorMessage(error)}
        </p>
        {Boolean(error?.message) && (
          <p className="mt-2 text-xs text-destructive font-mono break-all bg-destructive/10 p-2 rounded-md border border-destructive/20 text-left">
            {error.name}: {error.message}
          </p>
        )}
        {error.digest && (
          <p className="mt-3 inline-block max-w-full break-all rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" onClick={reset}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
