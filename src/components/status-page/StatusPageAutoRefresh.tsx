'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type StatusPageAutoRefreshProps = {
  enabled: boolean;
  intervalSeconds: number;
};

export default function StatusPageAutoRefresh({
  enabled,
  intervalSeconds,
}: StatusPageAutoRefreshProps) {
  const router = useRouter();
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Start paused; visibility handler will schedule interval when tab becomes visible.
    }

    const parsedInterval = Number.isFinite(intervalSeconds) ? intervalSeconds : 60;
    const clampedSeconds = Math.max(30, parsedInterval);
    const refreshMs = clampedSeconds * 1000;

    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      try {
        router.refresh();
      } catch (error) {
        console.error('[Status Page] Auto-refresh error:', error);
      }
    };

    const schedule = () => {
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(tick, refreshMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Refresh once on re-focus if we were hidden, then resume interval.
        tick();
        schedule();
      } else if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
    };
  }, [enabled, intervalSeconds, router]);

  return null;
}
