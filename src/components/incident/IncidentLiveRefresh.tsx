'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useOptionalRealtime } from '@/hooks/useRealtime';

/** At most one refresh per this window, however busy the incident (an alert storm bumps it constantly). */
const MIN_INTERVAL_MS = 10_000;
/** Coming back to the tab after at least this long refreshes once (notes do not always touch the incident). */
const STALE_AFTER_HIDDEN_MS = 60_000;
/** Server not reachable: try the refresh again after this long. */
const RETRY_UNREACHABLE_MS = 15_000;

/**
 * Keeps an open incident page current when someone else acts on it. It listens to the console's single shared
 * realtime connection (no new connection, no polling): when this incident's status or updatedAt changes, the
 * page's server components refresh — throttled, only while the tab is visible, and never under automation.
 * React keeps client state (a half-written note, an open tab) across the refresh.
 */
export default function IncidentLiveRefresh({ incidentId }: { incidentId: string }) {
  const realtime = useOptionalRealtime();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const seen = useRef<string | null>(null);
  const lastRefresh = useRef(0);
  const pending = useRef(false);
  /** A server check or refresh is under way: further updates fold into it (the refresh reads the latest). */
  const probing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef<number | null>(null);

  const entry = realtime?.recentIncidents.find(incident => incident.id === incidentId);
  const signature = entry ? `${String(entry.status)}|${String(entry.updatedAt)}` : null;

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    const refresh = async () => {
      timer.current = null;
      if (document.visibilityState !== 'visible') {
        pending.current = true; // catch up when the tab is shown again
        return;
      }
      // A refresh that fails (offline, or the network not back yet after the laptop wakes) would replace the
      // page with the error screen; check the server answers first and try again shortly if it does not.
      probing.current = true;
      const reachable =
        navigator.onLine !== false &&
        (await fetch('/api/health', { cache: 'no-store' })
          .then(response => response.ok)
          .catch(() => false));
      probing.current = false;
      if (!reachable) {
        pending.current = true;
        timer.current = setTimeout(() => void refresh(), RETRY_UNREACHABLE_MS);
        return;
      }
      pending.current = false;
      lastRefresh.current = Date.now();
      startTransition(() => router.refresh());
    };
    const schedule = () => {
      if (timer.current || probing.current) return;
      const wait = Math.max(0, lastRefresh.current + MIN_INTERVAL_MS - Date.now());
      timer.current = setTimeout(() => void refresh(), wait);
    };

    if (signature) {
      if (seen.current === null)
        seen.current = signature; // first sighting is the page we already have
      else if (signature !== seen.current) {
        seen.current = signature;
        schedule();
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (pending.current || away >= STALE_AFTER_HIDDEN_MS) schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [signature, router, startTransition]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return null;
}
