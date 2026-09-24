'use client';

import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { RefreshCw, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

export const MAX_AUTO_RELOADS = 2;
export const RELOAD_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const CHUNK_RECOVERY_STORAGE_KEY = 'opsknight_chunk_recovery';

interface ChunkRecoveryBudget {
  count: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
}

function isChunkOrStyleError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('loading chunk') ||
    normalized.includes('chunkloaderror') ||
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('error loading dynamically imported module') ||
    normalized.includes('css chunk load failed') ||
    normalized.includes('loading css chunk') ||
    normalized.includes('importing a module script failed')
  );
}

export function tryConsumeRecoveryBudget(reason: string): boolean {
  if (typeof window === 'undefined') return false;

  // In automated test environments (Playwright/WebDriver), never trigger
  // background hard reloads that collide with active test navigations.
  if (navigator.webdriver) {
    logger.warn('[ChunkRecovery] Suppressing auto-reload in automated test environment', {
      reason,
    });
    return false;
  }

  try {
    const raw = sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY);
    const now = Date.now();
    let budget: ChunkRecoveryBudget;

    if (raw) {
      budget = JSON.parse(raw);
      if (
        typeof budget.firstAttemptAt !== 'number' ||
        now - budget.firstAttemptAt > RELOAD_WINDOW_MS
      ) {
        budget = { count: 0, firstAttemptAt: now, lastAttemptAt: now };
      }
    } else {
      budget = { count: 0, firstAttemptAt: now, lastAttemptAt: now };
    }

    if (budget.count >= MAX_AUTO_RELOADS) {
      logger.warn('[ChunkRecovery] Automatic reload budget exhausted; prompting manual recovery', {
        reason,
        attempts: budget.count,
        max: MAX_AUTO_RELOADS,
        windowMs: RELOAD_WINDOW_MS,
      });
      return false;
    }

    budget.count += 1;
    budget.lastAttemptAt = now;
    sessionStorage.setItem(CHUNK_RECOVERY_STORAGE_KEY, JSON.stringify(budget));
    logger.warn(
      '[ChunkRecovery] Detected chunk/stylesheet error. Performing automatic recovery reload...',
      {
        reason,
        attempt: budget.count,
        max: MAX_AUTO_RELOADS,
      }
    );

    return true;
  } catch (err) {
    // Fail-safe: NEVER reload automatically if storage is corrupt or inaccessible.
    // Present manual recovery UI instead of risking an infinite reload loop.
    logger.error(
      '[ChunkRecovery] Failed to read/write storage budget; failing safe to recovery UI',
      {
        reason,
        error: err,
      }
    );
    return false;
  }
}

export function clearRecoveryBudget(): void {
  try {
    sessionStorage.removeItem(CHUNK_RECOVERY_STORAGE_KEY);
  } catch {
    // Ignore storage errors on clear
  }
}

export default function ChunkLoadErrorHandler() {
  const [recoveryRequired, setRecoveryRequired] = useState<{
    reason: string;
  } | null>(null);

  useEffect(() => {
    let isUnloading = false;
    const markUnloading = () => {
      isUnloading = true;
    };
    window.addEventListener('beforeunload', markUnloading);
    window.addEventListener('pagehide', markUnloading);

    const triggerRecovery = (reason: string) => {
      if (isUnloading) return;

      const allowed = tryConsumeRecoveryBudget(reason);
      if (allowed) {
        window.location.reload();
      } else if (!navigator.webdriver) {
        setRecoveryRequired({ reason });
      }
    };

    // 1. Listen for unhandled runtime errors & resource loading failures (capturing phase)
    const handleError = (event: ErrorEvent) => {
      if (isUnloading) return;

      if (event?.message && isChunkOrStyleError(event.message)) {
        triggerRecovery(`Runtime Error: ${event.message}`);
        return;
      }

      if (event?.error?.message && isChunkOrStyleError(event.error.message)) {
        triggerRecovery(`Runtime Error: ${event.error.message}`);
        return;
      }

      // Check for failed <link rel="stylesheet"> or <script> element
      const target = event.target as HTMLElement | null;
      if (target && target.nodeName) {
        const tagName = target.nodeName.toLowerCase();
        if (tagName === 'link' && (target as HTMLLinkElement).rel === 'stylesheet') {
          const href = (target as HTMLLinkElement).href || '';
          if (href.includes('/_next/static/')) {
            triggerRecovery(`Stylesheet load failure: ${href}`);
          }
        } else if (tagName === 'script') {
          if (document.visibilityState === 'hidden') return;
          const src = (target as HTMLScriptElement).src || '';
          if (src.includes('/_next/static/')) {
            triggerRecovery(`Script chunk load failure: ${src}`);
          }
        }
      }
    };

    // 2. Listen for unhandled promise rejections (dynamic imports)
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isUnloading) return;
      const reason = event?.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : reason?.message || '';

      if (message && isChunkOrStyleError(message)) {
        triggerRecovery(`Promise Rejection: ${message}`);
      }
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('beforeunload', markUnloading);
      window.removeEventListener('pagehide', markUnloading);
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (!recoveryRequired) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-50 max-w-md p-4 rounded-xl shadow-2xl bg-zinc-900 border border-zinc-700 text-white animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold tracking-tight text-zinc-100">
              Application Update Required
            </h4>
            <button
              type="button"
              onClick={() => setRecoveryRequired(null)}
              aria-label="Dismiss"
              className="text-zinc-400 hover:text-white p-1 rounded transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            A new version of OpsKnight is available or an asset failed to load. Please reload the
            application to ensure stability.
          </p>
          <div className="pt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer"
              onClick={() => {
                clearRecoveryBudget();
                window.location.reload();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload Page
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-zinc-400 hover:text-white cursor-pointer"
              onClick={() => setRecoveryRequired(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
