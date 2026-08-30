'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { logger } from '@/lib/logger';

export default function AuditLogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[AuditLog] Render error', {
      message: error.message,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] justify-center px-4 py-12 md:px-6">
      <section className="w-full max-w-lg rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
          <AlertCircle className="h-6 w-6 text-rose-600" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Audit log couldn&apos;t load</h1>
        <p className="mt-1 text-sm text-slate-600">
          Please try again. If this continues, an administrator can use the error details in System
          Logs to investigate.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </section>
    </main>
  );
}
