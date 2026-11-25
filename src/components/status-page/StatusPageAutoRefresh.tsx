'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type StatusPageAutoRefreshProps = {
  enabled: boolean;
  intervalSeconds: number;
  /** JSON status endpoint polled for a new revision; without it every tick refreshes the route. */
  apiPath?: string;
};

/**
 * Polls the lightweight JSON endpoint (If-None-Match, so an unchanged page costs a 304 and no body)
 * and only re-renders the route when the projection revision actually moved.
 */
export default function StatusPageAutoRefresh({
  enabled,
  intervalSeconds,
  apiPath,
}: StatusPageAutoRefreshProps) {
  const router = useRouter();
  const intervalRef = useRef<number | null>(null);
  const etagRef = useRef<string | null>(null);
  const revisionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const parsedInterval = Number.isFinite(intervalSeconds) ? intervalSeconds : 60;
    const refreshMs = Math.max(30, parsedInterval) * 1000;

    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        if (!apiPath) {
          router.refresh();
          return;
        }
        const response = await fetch(apiPath, {
          headers: etagRef.current ? { 'If-None-Match': etagRef.current } : undefined,
          credentials: 'same-origin',
        });
        if (response.status === 304) return;
        if (!response.ok) {
          // Token-gated or failing API: fall back to re-rendering the route.
          router.refresh();
          return;
        }
        etagRef.current = response.headers.get('etag');
        const body = (await response.json()) as { projection?: { revision?: string } };
        const revision = body.projection?.revision ?? null;
        // First poll only records the revision the page was rendered from.
        if (revisionRef.current !== null && revision !== revisionRef.current) router.refresh();
        revisionRef.current = revision;
      } catch (error) {
        console.error('[Status Page] Auto-refresh error:', error);
      }
    };

    const schedule = () => {
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(() => void tick(), refreshMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tick();
        schedule();
      } else if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    void tick();
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
    };
  }, [enabled, intervalSeconds, apiPath, router]);

  return null;
}
