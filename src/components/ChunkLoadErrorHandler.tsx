'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

const RELOAD_THROTTLE_MS = 15000;
const STORAGE_KEY = 'opsknight_chunk_reload_timestamp';

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

function handleAutoReload(reason: string) {
  if (typeof window === 'undefined') return;

  try {
    const lastReload = Number.parseInt(sessionStorage.getItem(STORAGE_KEY) || '0', 10);
    const now = Date.now();

    if (Number.isFinite(lastReload) && now - lastReload < RELOAD_THROTTLE_MS) {
      logger.warn('[ChunkRecovery] Throttling chunk reload to prevent infinite loop', {
        reason,
        timeSinceLastReload: now - lastReload,
      });
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, String(now));
    logger.warn('[ChunkRecovery] Detected chunk/stylesheet mismatch. Reloading application...', {
      reason,
    });

    // Hard reload from server to fetch latest build HTML and chunks
    window.location.reload();
  } catch (err) {
    logger.error('[ChunkRecovery] Failed to execute auto-reload', { error: err });
    window.location.reload();
  }
}

export default function ChunkLoadErrorHandler() {
  useEffect(() => {
    // 1. Listen for unhandled runtime errors & resource loading failures (capturing phase)
    const handleError = (event: ErrorEvent) => {
      // Check for Error message
      if (event?.message && isChunkOrStyleError(event.message)) {
        handleAutoReload(`Runtime Error: ${event.message}`);
        return;
      }

      if (event?.error?.message && isChunkOrStyleError(event.error.message)) {
        handleAutoReload(`Runtime Error: ${event.error.message}`);
        return;
      }

      // Check for failed <link rel="stylesheet"> or <script> element
      const target = event.target as HTMLElement | null;
      if (target && target.nodeName) {
        const tagName = target.nodeName.toLowerCase();
        if (tagName === 'link' && (target as HTMLLinkElement).rel === 'stylesheet') {
          const href = (target as HTMLLinkElement).href || '';
          if (href.includes('/_next/static/')) {
            handleAutoReload(`Stylesheet load failure: ${href}`);
          }
        } else if (tagName === 'script') {
          const src = (target as HTMLScriptElement).src || '';
          if (src.includes('/_next/static/')) {
            handleAutoReload(`Script chunk load failure: ${src}`);
          }
        }
      }
    };

    // 2. Listen for unhandled promise rejections (dynamic imports)
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : reason?.message || '';

      if (message && isChunkOrStyleError(message)) {
        handleAutoReload(`Promise Rejection: ${message}`);
      }
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
