'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';
import { toUserFacingError, isChunkLoadError } from '@/lib/user-facing-error';
import { purgeCachesAndReload } from '@/components/ChunkLoadErrorHandler';
import { AlertCircle, RefreshCw, RotateCcw } from 'lucide-react';

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('[Analytics] Render error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  const userFacing = toUserFacingError(error);
  const isChunk = isChunkLoadError(error);

  return (
    <div className="w-full px-4 py-12 flex justify-center">
      <div className="max-w-lg w-full rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center space-y-4 dark:border-rose-900/50 dark:bg-rose-950/20">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center dark:bg-rose-900/40">
          <AlertCircle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isChunk ? 'Application Update Available' : "Analytics couldn't load"}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {isChunk ? userFacing.description : userFacing.title}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          {isChunk ? (
            <>
              <button
                type="button"
                onClick={() => purgeCachesAndReload()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 transition cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Reload page
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Try again
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 transition cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
