'use client';

import { ReactNode } from 'react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  errorCode?: string;
  retryText?: string;
  onRetry?: () => void;
  onGoBack?: () => void;
  showDetails?: boolean;
  details?: string;
  icon?: ReactNode;
}

/**
 * ErrorState component for displaying error messages with actions
 *
 * @example
 * <ErrorState
 *   title="Failed to load data"
 *   message="Please try again"
 *   onRetry={() => refetch()}
 * />
 */
export default function ErrorState({
  title = 'Something went wrong',
  message = 'An error occurred while processing your request.',
  errorCode,
  retryText = 'Try Again',
  onRetry,
  onGoBack,
  showDetails = false,
  details,
  icon,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center min-h-[400px]">
      <div className="max-w-lg w-full">
        {/* Icon */}
        {icon || (
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-100 to-red-50 flex items-center justify-center mx-auto mb-6 border border-red-200">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
        )}

        {/* Title */}
        <h2 className="text-2xl font-extrabold tracking-tight text-foreground mb-2">{title}</h2>

        {/* Message */}
        <p className="text-base text-secondary-foreground mb-6 leading-relaxed">{message}</p>

        {/* Error Code */}
        {errorCode && (
          <div className="inline-block text-sm text-muted-foreground font-mono px-3 py-2 bg-muted rounded-sm border border-border mb-6">
            Error Code: {errorCode}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-center flex-wrap">
          {onRetry && (
            <Button onClick={onRetry} className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              {retryText}
            </Button>
          )}

          {onGoBack && (
            <Button onClick={onGoBack} variant="outline" className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Button>
          )}
        </div>

        {/* Details */}
        {showDetails && details && (
          <details className="mt-6 text-left w-full">
            <summary className="cursor-pointer text-sm text-secondary-foreground mb-2 select-none hover:text-foreground transition-colors">
              Show Details
            </summary>
            <pre className="text-xs text-muted-foreground p-4 bg-muted rounded-sm border border-border overflow-auto max-h-[300px] font-mono leading-relaxed">
              {details}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
