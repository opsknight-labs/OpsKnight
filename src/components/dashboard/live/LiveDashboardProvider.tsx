'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import {
  DEFAULT_LIVE_QUERY,
  LIVE_URL_PARAMS,
  coerceLiveQuery,
  countLiveFeedChanges,
  diffLiveIncidents,
  isCriticalIncident,
  liveQueryKey,
  liveQueryToParams,
  resolveConnectionHealth,
  type LiveConnectionHealth,
  type LiveIncident,
  type LiveIncidentQuery,
  type LiveSnapshot,
} from '@/lib/dashboard/live-incidents-shared';

const HIGHLIGHT_MS = 4_000;
const REALTIME_DEBOUNCE_MS = 75;
const SAFETY_RECONCILE_MS = 30_000;
const FAILURE_RETRY_MS = 5_000;
const CLOCK_TICK_MS = 5_000;
export const LIVE_QUERY_STORAGE_PREFIX = 'opsknight:dashboard:live-query:v1:';
const ALERTS_STORAGE_KEY = 'opsknight:dashboard:critical-alerts:v1';

export type OptimisticPatch = Partial<Pick<LiveIncident, 'status' | 'assignee'>>;

type ReconcileReason = 'realtime' | 'filter' | 'safety' | 'retry' | 'manual' | 'coalesced';

export type LiveDashboardContextValue = {
  currentUserId: string;
  query: LiveIncidentQuery;
  setQuery: (next: Partial<LiveIncidentQuery>, options?: { persist?: boolean }) => void;
  resetQuery: () => void;
  /** Latest canonical snapshot: drives counters, facets and rail even while the feed is paused. */
  snapshot: LiveSnapshot | null;
  /** Feed rows on screen (frozen while paused), with optimistic patches applied. */
  incidents: LiveIncident[];
  total: number;
  loading: boolean;
  syncError: boolean;
  syncedAt: number | null;
  health: LiveConnectionHealth;
  paused: boolean;
  togglePaused: () => void;
  pendingCount: number;
  highlighted: ReadonlySet<string>;
  now: number;
  refresh: () => void;
  applyOptimistic: (id: string, patch: OptimisticPatch) => () => void;
  criticalAlerts: boolean;
  setCriticalAlerts: (enabled: boolean) => void;
};

const LiveDashboardContext = createContext<LiveDashboardContextValue | null>(null);

export function useLiveDashboard(): LiveDashboardContextValue {
  const value = useContext(LiveDashboardContext);
  if (!value) throw new Error('useLiveDashboard must be used within LiveDashboardProvider');
  return value;
}

function hasLiveUrlParams(params: URLSearchParams): boolean {
  return Object.values(LIVE_URL_PARAMS).some(name => params.has(name));
}

function writeQueryToUrl(query: LiveIncidentQuery) {
  // replaceState keeps the shareable URL in sync without a Next.js navigation (no SSR re-run).
  const url = new URL(window.location.href);
  for (const name of Object.values(LIVE_URL_PARAMS)) url.searchParams.delete(name);
  liveQueryToParams(query, LIVE_URL_PARAMS).forEach((value, key) =>
    url.searchParams.set(key, value)
  );
  window.history.replaceState(window.history.state, '', url.toString());
}

function playAlertTone() {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio is best-effort.
  }
}

export function LiveDashboardProvider({
  initialSnapshot,
  currentUserId,
  persistQuery = true,
  children,
}: {
  initialSnapshot: LiveSnapshot | null;
  currentUserId: string;
  /** Shared displays (wallboards) are driven by their URL, never by a personal saved view. */
  persistQuery?: boolean;
  children: ReactNode;
}) {
  const {
    revision,
    changeCount,
    changeGeneration,
    connectionEpoch,
    isConnected,
    lastMessageAt,
    isRevoked,
  } = useRealtime();

  const [query, setQueryState] = useState<LiveIncidentQuery>(
    initialSnapshot?.query ?? DEFAULT_LIVE_QUERY
  );
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(initialSnapshot);
  const [displayed, setDisplayed] = useState<LiveSnapshot | null>(initialSnapshot);
  const [paused, setPaused] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(() =>
    initialSnapshot ? Date.parse(initialSnapshot.asOf) : null
  );
  const [syncError, setSyncError] = useState(false);
  const [loading, setLoading] = useState(initialSnapshot === null);
  const [highlightUntil, setHighlightUntil] = useState<Record<string, number>>({});
  const [optimistic, setOptimistic] = useState<Record<string, OptimisticPatch>>({});
  // Server and client must render identical relative times: start from the snapshot clock and
  // switch to the live clock after mount.
  const [now, setNow] = useState(() => (initialSnapshot ? Date.parse(initialSnapshot.asOf) : 0));
  const [online, setOnline] = useState(true);
  const [everConnected, setEverConnected] = useState(false);
  const [criticalAlerts, setCriticalAlertsState] = useState(false);

  const queryRef = useRef(query);
  const snapshotRef = useRef(snapshot);
  const displayedRef = useRef(displayed);
  const pausedRef = useRef(paused);
  const generationRef = useRef<string | null>(changeGeneration);
  const alertsRef = useRef(criticalAlerts);
  useEffect(() => {
    generationRef.current = changeGeneration;
  }, [changeGeneration]);
  useEffect(() => {
    alertsRef.current = criticalAlerts;
  }, [criticalAlerts]);
  const inFlightRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcileRef = useRef<(reason: ReconcileReason) => Promise<void>>(async () => {});

  const notifyNewCritical = useCallback((incidents: LiveIncident[]) => {
    if (!alertsRef.current || incidents.length === 0) return;
    if (document.visibilityState === 'visible') return;
    playAlertTone();
    if ('Notification' in window && Notification.permission === 'granted') {
      const [first] = incidents;
      const notification = new Notification(
        incidents.length === 1
          ? 'New critical incident'
          : `${incidents.length} new critical incidents`,
        { body: `${first.title} · ${first.service.name}`, tag: `opsknight-live-${first.id}` }
      );
      notification.onclick = () => {
        window.focus();
        window.location.assign(`/incidents/${first.id}`);
      };
    }
  }, []);

  const applyDisplayed = useCallback(
    (next: LiveSnapshot, highlightNew: boolean) => {
      const previous = displayedRef.current;
      if (highlightNew && previous && liveQueryKey(previous.query) === liveQueryKey(next.query)) {
        const { added } = diffLiveIncidents(previous.incidents, next.incidents);
        if (added.length > 0) {
          const until = Date.now() + HIGHLIGHT_MS;
          setHighlightUntil(current => {
            const updated = { ...current };
            for (const id of added) updated[id] = until;
            return updated;
          });
          const addedSet = new Set(added);
          notifyNewCritical(
            next.incidents.filter(item => addedSet.has(item.id) && isCriticalIncident(item))
          );
        }
      }
      displayedRef.current = next;
      setDisplayed(next);
      setOptimistic({});
    },
    [notifyNewCritical]
  );

  const reconcile = useCallback(
    async (reason: ReconcileReason) => {
      if (inFlightRef.current) {
        // Coalesce bursts: one follow-up fetch picks up everything that changed meanwhile.
        dirtyRef.current = true;
        return;
      }
      const requested = queryRef.current;
      const seq = ++seqRef.current;
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const params = liveQueryToParams(requested);
        if (generationRef.current) params.set('after', generationRef.current);
        const response = await fetch(`/api/dashboard/live?${params.toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`live dashboard ${response.status}`);
        const payload = (await response.json()) as { data: LiveSnapshot };
        if (seq !== seqRef.current || liveQueryKey(requested) !== liveQueryKey(queryRef.current)) {
          return;
        }
        snapshotRef.current = payload.data;
        setSnapshot(payload.data);
        setSyncError(false);
        setSyncedAt(Date.now());
        setLoading(false);
        if (!pausedRef.current || reason === 'filter') {
          applyDisplayed(payload.data, reason !== 'filter');
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError' || seq !== seqRef.current) return;
        setSyncError(true);
        setLoading(false);
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => void reconcileRef.current('retry'), FAILURE_RETRY_MS);
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          void reconcileRef.current('coalesced');
        }
      }
    },
    [applyDisplayed]
  );
  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  const scheduleReconcile = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void reconcileRef.current('realtime');
    }, REALTIME_DEBOUNCE_MS);
  }, []);

  const commitQuery = useCallback(
    (next: LiveIncidentQuery, persist: boolean) => {
      if (liveQueryKey(next) === liveQueryKey(queryRef.current)) return;
      queryRef.current = next;
      setQueryState(next);
      writeQueryToUrl(next);
      if (persist && persistQuery) {
        try {
          window.localStorage.setItem(
            LIVE_QUERY_STORAGE_PREFIX + currentUserId,
            JSON.stringify(next)
          );
        } catch {
          // Storage may be unavailable (private mode); the URL still carries the view.
        }
      }
      setLoading(true);
      // Abort any request for the previous query so its response can never render.
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      dirtyRef.current = false;
      void reconcileRef.current('filter');
    },
    [currentUserId, persistQuery]
  );

  const setQuery = useCallback(
    (patch: Partial<LiveIncidentQuery>, options?: { persist?: boolean }) =>
      commitQuery(coerceLiveQuery({ ...queryRef.current, ...patch }), options?.persist ?? true),
    [commitQuery]
  );
  const resetQuery = useCallback(() => commitQuery(DEFAULT_LIVE_QUERY, true), [commitQuery]);

  // Restore the user's saved view when the URL does not specify one.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (persistQuery && !hasLiveUrlParams(params)) {
        const stored = window.localStorage.getItem(LIVE_QUERY_STORAGE_PREFIX + currentUserId);
        if (stored) commitQuery(coerceLiveQuery(JSON.parse(stored)), false);
      }
      setCriticalAlertsState(window.localStorage.getItem(ALERTS_STORAGE_KEY) === 'on');
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }, [commitQuery, currentUserId, persistQuery]);

  // Realtime signals only invalidate; the authorized API projection is the source of truth.
  const lastSignalRef = useRef<string | null>(null);
  useEffect(() => {
    const signal = `${revision}:${changeCount}`;
    if (lastSignalRef.current === null) {
      lastSignalRef.current = signal;
      return;
    }
    if (signal === lastSignalRef.current) return;
    lastSignalRef.current = signal;
    scheduleReconcile();
  }, [revision, changeCount, scheduleReconcile]);

  // Every (re)connect may have missed changes: re-fetch canonical state.
  useEffect(() => {
    if (connectionEpoch === 0) return;
    setEverConnected(true);
    scheduleReconcile();
  }, [connectionEpoch, scheduleReconcile]);

  useEffect(() => {
    const safety = setInterval(() => {
      if (document.visibilityState === 'visible') void reconcileRef.current('safety');
    }, SAFETY_RECONCILE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        scheduleReconcile();
      }
    };
    const onNetwork = () => setOnline(navigator.onLine);
    onNetwork();
    setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(safety);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    };
  }, [scheduleReconcile]);

  useEffect(() => {
    const expiries = Object.values(highlightUntil);
    if (expiries.length === 0) return;
    const timer = setTimeout(
      () => {
        const cutoff = Date.now();
        setHighlightUntil(current =>
          Object.fromEntries(Object.entries(current).filter(([, until]) => until > cutoff))
        );
      },
      Math.max(0, Math.min(...expiries) - Date.now())
    );
    return () => clearTimeout(timer);
  }, [highlightUntil]);

  useEffect(
    () => () => {
      inFlightRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    []
  );

  const togglePaused = useCallback(() => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      if (snapshotRef.current) applyDisplayed(snapshotRef.current, true);
      scheduleReconcile();
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  }, [applyDisplayed, scheduleReconcile]);

  const applyOptimistic = useCallback((id: string, patch: OptimisticPatch) => {
    setOptimistic(current => ({ ...current, [id]: { ...current[id], ...patch } }));
    return () =>
      setOptimistic(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
  }, []);

  const setCriticalAlerts = useCallback((enabled: boolean) => {
    setCriticalAlertsState(enabled);
    try {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Preference is best-effort.
    }
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  const refresh = useCallback(() => void reconcileRef.current('manual'), []);

  const incidents = useMemo(() => {
    const rows = displayed?.incidents ?? [];
    if (Object.keys(optimistic).length === 0) return rows;
    return rows.map(row => (optimistic[row.id] ? { ...row, ...optimistic[row.id] } : row));
  }, [displayed, optimistic]);

  const pendingCount = useMemo(() => {
    if (!paused || !snapshot || !displayed) return 0;
    if (liveQueryKey(snapshot.query) !== liveQueryKey(displayed.query)) return 0;
    return countLiveFeedChanges(diffLiveIncidents(displayed.incidents, snapshot.incidents));
  }, [displayed, paused, snapshot]);

  const highlighted = useMemo(() => new Set(Object.keys(highlightUntil)), [highlightUntil]);

  const baseHealth = resolveConnectionHealth({
    isConnected,
    revoked: isRevoked,
    online,
    lastMessageAt,
    now,
    everConnected,
  });
  const health: LiveConnectionHealth = baseHealth === 'live' && syncError ? 'stale' : baseHealth;

  const value = useMemo<LiveDashboardContextValue>(
    () => ({
      currentUserId,
      query,
      setQuery,
      resetQuery,
      snapshot,
      incidents,
      total: displayed?.total ?? 0,
      loading,
      syncError,
      syncedAt,
      health,
      paused,
      togglePaused,
      pendingCount,
      highlighted,
      now,
      refresh,
      applyOptimistic,
      criticalAlerts,
      setCriticalAlerts,
    }),
    [
      currentUserId,
      query,
      setQuery,
      resetQuery,
      snapshot,
      incidents,
      displayed,
      loading,
      syncError,
      syncedAt,
      health,
      paused,
      togglePaused,
      pendingCount,
      highlighted,
      now,
      refresh,
      applyOptimistic,
      criticalAlerts,
      setCriticalAlerts,
    ]
  );

  return <LiveDashboardContext.Provider value={value}>{children}</LiveDashboardContext.Provider>;
}
