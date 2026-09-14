'use client';

import { useEffect, useRef } from 'react';
import { logger } from '@/lib/logger';

const CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * Detects a new immutable deployment without confusing HA replicas for releases.
 *
 * A deployment change is advisory while the page is active: responder workflows
 * must never be destroyed by a forced reload. PWA/update coordination may listen
 * for `opsknight:deployment-update` and offer a safe user-controlled activation.
 */
export default function VersionCheck() {
  const deploymentIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let controller: AbortController | null = null;

    const fetchVersion = async () => {
      if (!mounted || document.visibilityState === 'hidden' || !navigator.onLine) return;
      controller?.abort();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8_000);

      try {
        const res = await fetch(`/api/health?t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok || !mounted) return;

        const data = (await res.json()) as { deploymentId?: string; version?: string };
        const nextId = data.deploymentId || data.version;
        if (!nextId) return;

        if (deploymentIdRef.current === null) {
          deploymentIdRef.current = nextId;
          return;
        }

        if (deploymentIdRef.current !== nextId) {
          const previousId = deploymentIdRef.current;
          deploymentIdRef.current = nextId;
          logger.info('New deployment detected; deferring reload to safe update flow', {
            previousDeploymentId: previousId,
            deploymentId: nextId,
          });
          window.dispatchEvent(
            new CustomEvent('opsknight:deployment-update', {
              detail: { previousDeploymentId: previousId, deploymentId: nextId },
            })
          );
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        logger.debug('Version check failed', { error });
      } finally {
        clearTimeout(timeout);
      }
    };

    void fetchVersion();
    const interval = window.setInterval(() => void fetchVersion(), CHECK_INTERVAL_MS);
    const onFocus = () => void fetchVersion();
    const onOnline = () => void fetchVersion();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      mounted = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
