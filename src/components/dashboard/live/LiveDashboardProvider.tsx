'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useRealtime } from '@/hooks/useRealtime';
import {
  DEFAULT_LIVE_QUERY,
  LIVE_MAX_PINS,
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
import { reassignIncident, updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { useToast } from '@/hooks/use-product-notification';

const HIGHLIGHT_MS = 4_000;
const REALTIME_DEBOUNCE_MS = 75;
// Realtime-triggered re-reads are rate limited per viewer: during a burst of incident changes
// each console performs at most one read per gap, scaled up when the server is slow, with a small
// random offset so thousands of viewers do not read in lockstep. An idle dashboard is unaffected.
const MIN_RECONCILE_GAP_MS = 1_000;
const MAX_RECONCILE_GAP_MS = 5_000;
const RECONCILE_JITTER_MS = 150;
const SAFETY_RECONCILE_MS = 30_000;
const FAILURE_RETRY_MS = 5_000;
const CLOCK_TICK_MS = 5_000;
export const LIVE_QUERY_STORAGE_PREFIX = 'opsknight:dashboard:live-query:v1:';
const ALERTS_STORAGE_KEY = 'opsknight:dashboard:critical-alerts:v1';
const PINS_STORAGE_PREFIX = 'opsknight:dashboard:pins:v1:';
const DENSITY_STORAGE_KEY = 'opsknight:dashboard:density:v1';
export type LiveDensity = 'comfortable' | 'compact';

export type OptimisticPatch = Partial<Pick<LiveIncident, 'status' | 'assignee'>>;

type ReconcileReason = 'realtime' | 'filter' | 'safety' | 'retry' | 'manual' | 'coalesced';

export type LiveDashboardContextValue = {
  currentUserId: string;
  currentUserName: string;
  canAcknowledge: boolean;
  canAssignSelf: boolean;
  busyMap: Record<string, 'ack' | 'assign'>;
  acknowledgeIncident: (incident: LiveIncident) => Promise<void>;
  assignIncidentToMe: (incident: LiveIncident) => Promise<void>;
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
  pins: readonly string[];
  togglePin: (id: string) => void;
  density: LiveDensity;
  setDensity: (density: LiveDensity) => void;
  selectedIncidentId: string | null;
  selectedIncident: LiveIncident | null;
  selectIncident: (id: string | null) => void;
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

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const alertListeners = new Set<() => void>();
function subscribeAlerts(onChange: () => void) {
  alertListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    alertListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}
const storageListeners = new Set<() => void>();
function subscribeStorage(onChange: () => void) {
  storageListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    storageListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences are best-effort.
  }
  storageListeners.forEach(notify => notify());
}

function readAlertsPreference(): boolean {
  try {
    return window.localStorage.getItem(ALERTS_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
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
  currentUserName = '',
  canAcknowledge = false,
  canAssignSelf = false,
  persistQuery = true,
  children,
}: {
  initialSnapshot: LiveSnapshot | null;
  currentUserId: string;
  currentUserName?: string;
  canAcknowledge?: boolean;
  canAssignSelf?: boolean;
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
  const [highlightUntil, setHighlightUntil] = useState<ReadonlyMap<string, number>>(new Map());
  const [optimistic, setOptimistic] = useState<ReadonlyMap<string, OptimisticPatch>>(new Map());
  // Server and client must render identical relative times: start from the snapshot clock and
  // switch to the live clock after mount.
  const [now, setNow] = useState(() => (initialSnapshot ? Date.parse(initialSnapshot.asOf) : 0));
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );
  const criticalAlerts = useSyncExternalStore(subscribeAlerts, readAlertsPreference, () => false);
  const everConnected = connectionEpoch > 0;
  const pinsKey = PINS_STORAGE_PREFIX + currentUserId;
  const pinsRaw = useSyncExternalStore(
    subscribeStorage,
    () => readStorage(pinsKey),
    () => null
  );
  const pins = useMemo<readonly string[]>(() => {
    try {
      const parsed: unknown = pinsRaw ? JSON.parse(pinsRaw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string').slice(0, LIVE_MAX_PINS)
        : [];
    } catch {
      return [];
    }
  }, [pinsRaw]);
  const pinsRef = useRef(pins);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);
  const density: LiveDensity =
    useSyncExternalStore(
      subscribeStorage,
      () => readStorage(DENSITY_STORAGE_KEY),
      () => null
    ) === 'compact'
      ? 'compact'
      : 'comfortable';
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

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
  const lastStartRef = useRef(0);
  const lastDurationRef = useRef(0);
  // Validator of the last full response, only valid for the exact request it answered.
  const etagRef = useRef<{ key: string; etag: string } | null>(null);
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
        routerRef.current.push(`/incidents/${first.id}`);
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
            const updated = new Map(current);
            for (const id of added) updated.set(id, until);
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
      setOptimistic(new Map());
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
      const startedAt = Date.now();
      lastStartRef.current = startedAt;
      try {
        const params = liveQueryToParams(requested);
        const requestKey = `${liveQueryKey(requested)}|${pinsRef.current.join(',')}`;
        if (generationRef.current) params.set('after', generationRef.current);
        if (pinsRef.current.length) params.set('ids', pinsRef.current.join(','));
        const headers: Record<string, string> = {};
        const known = etagRef.current;
        const current = snapshotRef.current;
        if (
          reason !== 'manual' &&
          reason !== 'filter' &&
          known &&
          known.key === requestKey &&
          current &&
          liveQueryKey(current.query) === liveQueryKey(requested)
        ) {
          headers['If-None-Match'] = known.etag;
        }
        const response = await fetch(`/api/dashboard/live?${params.toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers,
          signal: controller.signal,
        });
        lastDurationRef.current = Date.now() - startedAt;
        if (seq !== seqRef.current || liveQueryKey(requested) !== liveQueryKey(queryRef.current)) {
          return;
        }
        if (response.status === 304) {
          // Nothing materially changed: keep the current projection, refresh the sync clock.
          setSyncError(false);
          setSyncedAt(Date.now());
          setLoading(false);
          return;
        }
        if (!response.ok) throw new Error(`live dashboard ${response.status}`);
        const etag = response.headers.get('ETag');
        etagRef.current = etag ? { key: requestKey, etag } : null;
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
    // A hidden tab has no realtime connection and re-reads when it becomes visible again.
    if (document.visibilityState === 'hidden') return;
    // A pending read already covers every signal that arrives before it fires; resetting the
    // timer instead would let a steady stream of changes postpone the read forever.
    if (debounceRef.current) return;
    const gap = Math.min(
      MAX_RECONCILE_GAP_MS,
      Math.max(MIN_RECONCILE_GAP_MS, lastDurationRef.current * 3)
    );
    const wait =
      Math.max(REALTIME_DEBOUNCE_MS, lastStartRef.current + gap - Date.now()) +
      Math.floor(Math.random() * RECONCILE_JITTER_MS);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void reconcileRef.current('realtime');
    }, wait);
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
        // Synchronizes with an external store (localStorage) that does not exist during SSR.
        if (stored) commitQuery(coerceLiveQuery(JSON.parse(stored)), false);
      }
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }, [commitQuery, currentUserId, persistQuery]);

  // Realtime signals only invalidate; the authorized API projection is the source of truth.
  const lastSignalRef = useRef<string | null>(null);
  useEffect(() => {
    // `changed` signals carry the durable generation and are the only trigger once they flow;
    // legacy `revision` bumps (one per incident/metrics payload) are not a second signal.
    const signal = changeCount > 0 ? `c:${changeCount}` : `r:${revision}`;
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
    // Switch from the server snapshot clock to the live clock right after hydration.
    const hydrated = setTimeout(() => setNow(Date.now()), 0);
    document.addEventListener('visibilitychange', onVisible);
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(safety);
      clearInterval(tick);
      clearTimeout(hydrated);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [scheduleReconcile]);

  useEffect(() => {
    const expiries = [...highlightUntil.values()];
    if (expiries.length === 0) return;
    const timer = setTimeout(
      () => {
        const cutoff = Date.now();
        setHighlightUntil(current => new Map([...current].filter(([, until]) => until > cutoff)));
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

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [cachedIncident, setCachedIncident] = useState<LiveIncident | null>(null);
  // Inspector-only context (routing rule, runbook, policy, dedup key) is loaded on demand for
  // the one open incident instead of being carried by every row of the bulk feed.
  const [detail, setDetail] = useState<LiveIncident | null>(null);

  const applyOptimistic = useCallback((id: string, patch: OptimisticPatch) => {
    setOptimistic(current => new Map(current).set(id, { ...current.get(id), ...patch }));
    setCachedIncident(prev => {
      if (!prev || prev.id !== id) return prev;
      return {
        ...prev,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.assignee ? { assignee: patch.assignee } : {}),
      };
    });
    return () =>
      setOptimistic(current => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
  }, []);

  const setCriticalAlerts = useCallback((enabled: boolean) => {
    try {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Preference is best-effort.
    }
    alertListeners.forEach(notify => notify());
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  const refresh = useCallback(() => void reconcileRef.current('manual'), []);

  const togglePin = useCallback(
    (id: string) => {
      const current = pinsRef.current;
      const next = current.includes(id)
        ? current.filter(pin => pin !== id)
        : [id, ...current].slice(0, LIVE_MAX_PINS);
      pinsRef.current = next;
      writeStorage(pinsKey, JSON.stringify(next));
      void reconcileRef.current('manual');
    },
    [pinsKey]
  );
  const setDensity = useCallback(
    (value: LiveDensity) => writeStorage(DENSITY_STORAGE_KEY, value),
    []
  );

  const incidents = useMemo(() => {
    const rows = displayed?.incidents ?? [];
    if (optimistic.size === 0) return rows;
    return rows.map(row => {
      const patch = optimistic.get(row.id);
      return patch ? { ...row, ...patch } : row;
    });
  }, [displayed, optimistic]);

  const pendingCount = useMemo(() => {
    if (!paused || !snapshot || !displayed) return 0;
    if (liveQueryKey(snapshot.query) !== liveQueryKey(displayed.query)) return 0;
    return countLiveFeedChanges(diffLiveIncidents(displayed.incidents, snapshot.incidents));
  }, [displayed, paused, snapshot]);

  const highlighted = useMemo(() => new Set(highlightUntil.keys()), [highlightUntil]);

  const baseHealth = resolveConnectionHealth({
    isConnected,
    revoked: isRevoked,
    online,
    lastMessageAt,
    now,
    everConnected,
  });
  const health: LiveConnectionHealth = baseHealth === 'live' && syncError ? 'stale' : baseHealth;

  const selectedIncidentInFeed = useMemo(() => {
    if (!selectedIncidentId) return null;
    return (
      incidents.find(i => i.id === selectedIncidentId) ??
      snapshot?.incidents.find(i => i.id === selectedIncidentId) ??
      snapshot?.pinned.find(i => i.id === selectedIncidentId) ??
      snapshot?.attention.find(a => a.incident.id === selectedIncidentId)?.incident ??
      null
    );
  }, [selectedIncidentId, incidents, snapshot]);

  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId) return null;
    const base =
      selectedIncidentInFeed ??
      (cachedIncident && cachedIncident.id === selectedIncidentId ? cachedIncident : null);
    if (!base) return null;
    if (!detail || detail.id !== selectedIncidentId) return base;
    return {
      ...base,
      dedupKey: detail.dedupKey,
      escalationPolicyName: detail.escalationPolicyName,
      routeRuleName: detail.routeRuleName,
      latestRunbook: detail.latestRunbook,
    };
  }, [selectedIncidentId, selectedIncidentInFeed, cachedIncident, detail]);

  // Load the authorized detail for the open incident; re-read when the feed row changes so the
  // enrichment stays current. Also covers incidents filtered out of the current feed page.
  const selectedUpdatedAt = selectedIncidentInFeed?.updatedAt ?? null;
  useEffect(() => {
    if (!selectedIncidentId) return;
    let cancelled = false;
    fetch(`/api/dashboard/live/incidents/${encodeURIComponent(selectedIncidentId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const incident = data?.data?.incident as LiveIncident | undefined;
        if (cancelled || !incident) return;
        setDetail(incident);
        setCachedIncident(previous =>
          previous && previous.id === incident.id ? previous : incident
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedIncidentId, selectedUpdatedAt]);

  const selectIncident = useCallback(
    (id: string | null) => {
      setSelectedIncidentId(id);
      if (!id) {
        setCachedIncident(null);
        setDetail(null);
      } else {
        const match =
          incidents.find(i => i.id === id) ??
          snapshot?.incidents.find(i => i.id === id) ??
          snapshot?.pinned.find(i => i.id === id) ??
          snapshot?.attention.find(a => a.incident.id === id)?.incident ??
          null;
        if (match) setCachedIncident(match);
      }
    },
    [incidents, snapshot]
  );

  const [busyMap, setBusyMap] = useState<Record<string, 'ack' | 'assign'>>({});
  const { showToast } = useToast();

  const acknowledgeIncident = useCallback(
    async (incident: LiveIncident) => {
      if (busyMap[incident.id]) return;
      setBusyMap(prev => ({ ...prev, [incident.id]: 'ack' }));
      const rollback = applyOptimistic(incident.id, { status: 'ACKNOWLEDGED' });
      try {
        await updateIncidentStatus(incident.id, 'ACKNOWLEDGED', 'OPEN');
        showToast(`Acknowledged “${incident.title}”`, 'success');
        refresh();
      } catch (error) {
        rollback();
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        showToast(getUserFacingErrorMessage(error) || 'Could not acknowledge incident', 'error');
      } finally {
        setBusyMap(prev => {
          const next = { ...prev };
          delete next[incident.id];
          return next;
        });
      }
    },
    [applyOptimistic, busyMap, refresh, showToast]
  );

  const assignIncidentToMe = useCallback(
    async (incident: LiveIncident) => {
      if (busyMap[incident.id]) return;
      setBusyMap(prev => ({ ...prev, [incident.id]: 'assign' }));
      const rollback = applyOptimistic(incident.id, {
        assignee: { id: currentUserId, name: currentUserName || 'You' },
      });
      try {
        await reassignIncident(incident.id, currentUserId);
        showToast(`Assigned “${incident.title}” to you`, 'success');
        refresh();
      } catch (error) {
        rollback();
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        showToast(getUserFacingErrorMessage(error) || 'Could not assign incident', 'error');
      } finally {
        setBusyMap(prev => {
          const next = { ...prev };
          delete next[incident.id];
          return next;
        });
      }
    },
    [applyOptimistic, busyMap, currentUserId, currentUserName, refresh, showToast]
  );

  const value = useMemo<LiveDashboardContextValue>(
    () => ({
      currentUserId,
      currentUserName,
      canAcknowledge,
      canAssignSelf,
      busyMap,
      acknowledgeIncident,
      assignIncidentToMe,
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
      pins,
      togglePin,
      density,
      setDensity,
      selectedIncidentId,
      selectedIncident,
      selectIncident,
    }),
    [
      currentUserId,
      currentUserName,
      canAcknowledge,
      canAssignSelf,
      busyMap,
      acknowledgeIncident,
      assignIncidentToMe,
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
      pins,
      togglePin,
      density,
      setDensity,
      selectedIncidentId,
      selectedIncident,
      selectIncident,
    ]
  );

  return <LiveDashboardContext.Provider value={value}>{children}</LiveDashboardContext.Provider>;
}
