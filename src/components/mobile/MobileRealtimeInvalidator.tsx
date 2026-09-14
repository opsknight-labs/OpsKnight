'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtime } from '@/hooks/useRealtime';

const REFRESH_DEBOUNCE_MS = 250;

/**
 * Bridges the canonical realtime stream into Server Component read models.
 *
 * Realtime is the invalidation signal; authorization-scoped server projections
 * remain the source of truth. Debouncing collapses paired incident/metrics events
 * into one RSC refresh and avoids maintaining a second client-side projection.
 */
export default function MobileRealtimeInvalidator() {
  const router = useRouter();
  const { revision } = useRealtime();
  const [, startTransition] = useTransition();
  const lastRefreshedRevision = useRef(0);
  const pendingRevision = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (revision <= 0 || revision <= lastRefreshedRevision.current) return;
    pendingRevision.current = Math.max(pendingRevision.current, revision);

    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const targetRevision = pendingRevision.current;
      if (targetRevision <= lastRefreshedRevision.current) return;
      lastRefreshedRevision.current = targetRevision;
      startTransition(() => router.refresh());
    };

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(refresh, REFRESH_DEBOUNCE_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [revision, router, startTransition]);

  return null;
}
