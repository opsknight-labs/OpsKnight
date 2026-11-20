'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';

export type ErrorStateProps = {
  /** Names the problem in plain words. */
  title?: string;
  /** What happened and how to recover. */
  message?: ReactNode;
  /** Request/correlation ID or error code, shown so support can trace it. */
  errorCode?: string;
  retryText?: string;
  onRetry?: () => void;
  /** Shows a spinner on the retry button while a refetch is running. */
  isRetrying?: boolean;
  onGoBack?: () => void;
  /** Secondary link back (used when `onGoBack` is not given). */
  backHref?: string;
  backLabel?: string;
  /** Technical details in a closed disclosure (stack, response body). */
  details?: string;
  icon?: ReactNode;
  /** `page` fills a route; `inline` sits inside a card or panel. */
  variant?: 'page' | 'inline';
  className?: string;
};

/** Recoverable error: the problem, a retry, a way back and an optional details disclosure. */
export default function ErrorState({
  title = 'Something went wrong',
  message = 'An error occurred while processing your request.',
  errorCode,
  retryText = 'Try again',
  onRetry,
  isRetrying = false,
  onGoBack,
  backHref,
  backLabel = 'Go back',
  details,
  icon,
  variant = 'page',
  className,
}: ErrorStateProps) {
  const isPage = variant === 'page';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isPage ? 'min-h-[400px] px-6 py-12' : 'rounded-lg border border-border bg-card px-4 py-8',
        className
      )}
    >
      <div className={cn('w-full', isPage ? 'max-w-lg' : 'max-w-md')}>
        {icon ?? (
          <div
            aria-hidden="true"
            className={cn(
              'mx-auto flex items-center justify-center rounded-full border border-status-critical-border/25 bg-status-critical-soft text-status-critical dark:border-status-critical/35 dark:bg-status-critical/15 dark:text-rose-300',
              isPage
                ? 'mb-6 h-16 w-16 [&>svg]:h-8 [&>svg]:w-8'
                : 'mb-3 h-10 w-10 [&>svg]:h-5 [&>svg]:w-5'
            )}
          >
            <AlertCircle />
          </div>
        )}

        <h2
          className={cn(
            'font-semibold tracking-tight text-foreground',
            isPage ? 'mb-2 text-2xl font-extrabold' : 'mb-1 text-base'
          )}
        >
          {title}
        </h2>

        <div
          className={cn(
            'leading-relaxed text-muted-foreground',
            isPage ? 'mb-6 text-base' : 'mb-4 text-sm'
          )}
        >
          {message}
        </div>

        {errorCode && (
          <p className="mb-6 inline-block rounded-sm border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            Reference: <span className="select-all">{errorCode}</span>
          </p>
        )}

        {(onRetry || onGoBack || backHref) && (
          <div className="flex flex-wrap justify-center gap-3">
            {onRetry && (
              <Button onClick={onRetry} loading={isRetrying} size={isPage ? 'default' : 'sm'}>
                <RefreshCw aria-hidden="true" />
                {retryText}
              </Button>
            )}
            {onGoBack ? (
              <Button onClick={onGoBack} variant="outline" size={isPage ? 'default' : 'sm'}>
                <ArrowLeft aria-hidden="true" />
                {backLabel}
              </Button>
            ) : (
              backHref && (
                <Button asChild variant="outline" size={isPage ? 'default' : 'sm'}>
                  <Link href={backHref}>
                    <ArrowLeft aria-hidden="true" />
                    {backLabel}
                  </Link>
                </Button>
              )
            )}
          </div>
        )}

        {details && (
          <details className="group mt-6 w-full text-left">
            <summary className="mb-2 cursor-pointer select-none rounded-sm text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Technical details
            </summary>
            <pre className="max-h-[300px] overflow-auto rounded-sm border border-border bg-muted p-4 font-mono text-xs leading-relaxed text-muted-foreground">
              {details}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
