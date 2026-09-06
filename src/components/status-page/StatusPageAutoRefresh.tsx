'use client';

import { useEffect } from 'react';
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
  useEffect(() => {
    if (!enabled) return;

    const parsedInterval = Number.isFinite(intervalSeconds) ? intervalSeconds : 60;
    const clampedSeconds = Math.max(30, parsedInterval);
    const refreshMs = clampedSeconds * 1000;

    const timeout = window.setTimeout(() => {
      try {
        router.refresh();
      } catch (error) {
        console.error('[Status Page] Auto-refresh error:', error);
      }
    }, refreshMs);

    return () => window.clearTimeout(timeout);
  }, [enabled, intervalSeconds, router]);

  return null;
}
