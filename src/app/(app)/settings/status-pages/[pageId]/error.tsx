'use client';

import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { AlertCircle, RefreshCw, Copy, Check } from 'lucide-react';

export default function StatusPageDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const correlationId = error.digest ? `SP-${error.digest.slice(0, 8).toUpperCase()}` : 'SP-SYS';

  useEffect(() => {
    logger.error('[StatusPageDetail] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
      correlationId,
    });
  }, [error, correlationId]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(correlationId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full px-4 py-12 flex justify-center">
      <div className="max-w-lg w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Status Page settings couldn&apos;t load</h2>
          <p className="text-sm text-muted-foreground mt-1">{getUserFacingErrorMessage(error)}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-xs font-mono hover:bg-muted transition-colors"
            title="Copy Error Correlation ID"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span>{correlationId}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
