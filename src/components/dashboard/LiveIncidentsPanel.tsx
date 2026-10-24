'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Pause, Play, Radio, RefreshCw, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import StatusBadge from '@/components/incident/StatusBadge';
import PriorityBadge from '@/components/incident/PriorityBadge';
import { useRealtime } from '@/hooks/useRealtime';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  LIVE_INCIDENT_FILTER_LABELS,
  LIVE_INCIDENT_FILTERS,
  LIVE_INCIDENT_VISIBLE_ROWS,
  countLiveFeedChanges,
  diffLiveIncidents,
  formatIncidentAge,
  resolveConnectionHealth,
  sortLiveIncidents,
  type LiveConnectionHealth,
  type LiveIncident,
  type LiveIncidentFeed,
  type LiveIncidentFilter,
} from '@/lib/dashboard/live-incidents-shared';

const HIGHLIGHT_MS = 4_000;
const REALTIME_DEBOUNCE_MS = 75;
const SAFETY_RECONCILE_MS = 30_000;
const FAILURE_RETRY_MS = 5_000;
const CLOCK_TICK_MS = 5_000;

type LiveIncidentsPanelProps = {
  initialFeed: LiveIncidentFeed | null;
  currentUserId: string;
};

const HEALTH_COPY: Record<LiveConnectionHealth, { label: string; dot: string; text: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  connecting: {
    label: 'Connecting',
    dot: 'bg-slate-400',
    text: 'text-muted-foreground',
  },
  stale: { label: 'Stale', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  offline: { label: 'Offline', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  revoked: {
    label: 'Session expired',
    dot: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
  },
};

function viewAllHref(filter: LiveIncidentFilter, currentUserId: string): string {
  switch (filter) {
    case 'critical':
      return buildIncidentListHref({ filter: 'critical_focus' });
    case 'mine':
      return buildIncidentListHref({ filter: 'all_open', assignee: currentUserId });
    case 'my_teams':
      return buildIncidentListHref({ filter: 'all_open', teamId: 'mine' });
    default:
      return buildIncidentListHref({ filter: 'all_open' });
  }
}

function formatSyncAge(syncedAt: number | null, now: number): string {
  if (syncedAt === null) return 'Not synced yet';
  const seconds = Math.max(0, Math.round((now - syncedAt) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

const LiveIncidentRow = memo(function LiveIncidentRow({
  incident,
  now,
  highlighted,
}: {
  incident: LiveIncident;
  now: number;
  highlighted: boolean;
}) {
  const accent = incident.status === 'OPEN' ? 'bg-rose-500' : 'bg-amber-500';
  return (
    <li
      data-testid="live-incident-row"
      data-incident-id={incident.id}
      data-status={incident.status}
      data-highlighted={highlighted ? 'true' : 'false'}
      className={cn(
        'relative transition-colors duration-700',
        highlighted ? 'bg-primary/[0.07]' : 'bg-transparent'
      )}
    >
      <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 w-[3px]', accent)} />
      <Link
        href={`/incidents/${incident.id}`}
        className={cn(
          'grid items-center gap-x-3 gap-y-1.5 pl-4 pr-3 py-2.5 sm:py-2 outline-none',
          'grid-cols-[auto_1fr_auto] md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,11rem)_7.5rem_minmax(0,9rem)_3.5rem]',
          'hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset'
        )}
      >
        <span className="row-span-2 md:row-span-1 self-start md:self-center">
          {incident.priority ? (
            <PriorityBadge priority={incident.priority} size="sm" showLabel={false} />
          ) : (
            <Badge variant="neutral" size="xs" className="font-mono">
              {incident.urgency === 'HIGH' ? 'HIGH' : incident.urgency.slice(0, 3)}
            </Badge>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">
            {incident.title}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground md:hidden">
            {incident.service.name}
          </span>
        </span>
        <span className="hidden md:block truncate text-xs text-muted-foreground">
          {incident.service.name}
        </span>
        <span className="col-start-2 md:col-start-auto flex items-center gap-2 md:block">
          <StatusBadge
            status={incident.status}
            label={incident.status === 'OPEN' ? 'Triggered' : 'Acknowledged'}
            size="xs"
            showDot
          />
          <span className="md:hidden flex items-center gap-1 text-[11px] text-muted-foreground truncate">
            <UserRound className="h-3 w-3 shrink-0" aria-hidden />
            {incident.assignee?.name ?? 'Unassigned'}
          </span>
        </span>
        <span
          className={cn(
            'hidden md:flex items-center gap-1.5 truncate text-xs',
            incident.assignee ? 'text-foreground' : 'text-amber-700 dark:text-amber-400'
          )}
        >
          <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{incident.assignee?.name ?? 'Unassigned'}</span>
        </span>
        <time
          dateTime={incident.createdAt}
          title={new Date(incident.createdAt).toLocaleString()}
          className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto text-right text-xs font-medium tabular-nums text-muted-foreground"
        >
          {formatIncidentAge(incident.createdAt, now)}
        </time>
      </Link>
    </li>
  );
});

export default function LiveIncidentsPanel({
  initialFeed,
  currentUserId,
}: LiveIncidentsPanelProps) {
  const { revision, connectionEpoch, isConnected, lastMessageAt, isRevoked } = useRealtime();

  const [filter, setFilter] = useState<LiveIncidentFilter>(initialFeed?.filter ?? 'active');
  const [feed, setFeed] = useState<LiveIncidentFeed | null>(initialFeed);
  const [pendingFeed, setPendingFeed] = useState<LiveIncidentFeed | null>(null);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(() =>
    initialFeed ? Date.parse(initialFeed.asOf) : null
  );
  const [syncError, setSyncError] = useState(false);
  const [loading, setLoading] = useState(initialFeed === null);
  const [highlighted, setHighlighted] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [everConnected, setEverConnected] = useState(false);

  const feedRef = useRef(feed);
  feedRef.current = feed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const inFlightRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const requestSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFeed = useCallback((next: LiveIncidentFeed, highlightNew: boolean) => {
    const previous = feedRef.current;
    if (highlightNew && previous && previous.filter === next.filter) {
      const { added } = diffLiveIncidents(previous.incidents, next.incidents);
      if (added.length > 0) {
        const until = Date.now() + HIGHLIGHT_MS;
        setHighlighted(current => {
          const updated = { ...current };
          for (const id of added) updated[id] = until;
          return updated;
        });
      }
    }
    feedRef.current = next;
    setFeed(next);
  }, []);

  const reconcile = useCallback(
    async (options: { highlightNew: boolean; reason: string }) => {
      if (inFlightRef.current) {
        // Coalesce bursts: one follow-up fetch picks up everything that changed meanwhile.
        dirtyRef.current = true;
        return;
      }
      const requestFilter = filterRef.current;
      const seq = ++requestSeqRef.current;
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const response = await fetch(
          `/api/dashboard/live-incidents?filter=${encodeURIComponent(requestFilter)}`,
          { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) throw new Error(`live feed ${response.status}`);
        const payload = (await response.json()) as { data: LiveIncidentFeed };
        if (seq !== requestSeqRef.current || requestFilter !== filterRef.current) return;
        const next: LiveIncidentFeed = {
          ...payload.data,
          incidents: sortLiveIncidents(payload.data.incidents),
        };
        setSyncError(false);
        setSyncedAt(Date.now());
        setLoading(false);
        if (pausedRef.current && options.reason !== 'filter') {
          setPendingFeed(next);
        } else {
          setPendingFeed(null);
          applyFeed(next, options.highlightNew);
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        if (seq !== requestSeqRef.current) return;
        setSyncError(true);
        setLoading(false);
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = setTimeout(
          () => void reconcile({ highlightNew: true, reason: 'retry' }),
          FAILURE_RETRY_MS
        );
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          void reconcile({ highlightNew: true, reason: 'coalesced' });
        }
      }
    },
    [applyFeed]
  );

  const scheduleReconcile = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void reconcile({ highlightNew: true, reason: 'realtime' });
    }, REALTIME_DEBOUNCE_MS);
  }, [reconcile]);

  // Realtime events only invalidate; the API read path is the source of truth.
  const lastRevisionRef = useRef(revision);
  useEffect(() => {
    if (revision === lastRevisionRef.current) return;
    lastRevisionRef.current = revision;
    scheduleReconcile();
  }, [revision, scheduleReconcile]);

  // Every (re)connect may have missed changes: re-fetch canonical state.
  useEffect(() => {
    if (connectionEpoch === 0) return;
    setEverConnected(true);
    scheduleReconcile();
  }, [connectionEpoch, scheduleReconcile]);

  // Safety net for missed notifications (e.g. a dropped event during a proxy hiccup).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void reconcile({ highlightNew: true, reason: 'safety' });
      }
    }, SAFETY_RECONCILE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleReconcile();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reconcile, scheduleReconcile]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    const ids = Object.keys(highlighted);
    if (ids.length === 0) return;
    const nextExpiry = Math.min(...Object.values(highlighted));
    const timer = setTimeout(
      () => {
        const cutoff = Date.now();
        setHighlighted(current =>
          Object.fromEntries(Object.entries(current).filter(([, until]) => until > cutoff))
        );
      },
      Math.max(0, nextExpiry - Date.now())
    );
    return () => clearTimeout(timer);
  }, [highlighted]);

  useEffect(
    () => () => {
      inFlightRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    []
  );

  const changeFilter = (next: LiveIncidentFilter) => {
    if (next === filterRef.current) return;
    filterRef.current = next;
    setFilter(next);
    setExpanded(false);
    setPendingFeed(null);
    setLoading(true);
    // Abort any request for the previous filter so its response can never render.
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    dirtyRef.current = false;
    void reconcile({ highlightNew: false, reason: 'filter' });
  };

  const togglePaused = () => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      if (pendingFeed) {
        applyFeed(pendingFeed, true);
        setPendingFeed(null);
      }
      scheduleReconcile();
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  };

  const pendingCount = useMemo(() => {
    if (!pendingFeed || !feed) return 0;
    return countLiveFeedChanges(diffLiveIncidents(feed.incidents, pendingFeed.incidents));
  }, [feed, pendingFeed]);

  const health = resolveConnectionHealth({
    isConnected,
    revoked: isRevoked,
    online,
    lastMessageAt,
    now,
    everConnected,
  });
  const effectiveHealth: LiveConnectionHealth = health === 'live' && syncError ? 'stale' : health;
  const healthCopy = HEALTH_COPY[effectiveHealth];

  const incidents = feed?.incidents ?? [];
  const visibleIncidents = expanded ? incidents : incidents.slice(0, LIVE_INCIDENT_VISIBLE_ROWS);
  const total = feed?.total ?? 0;
  const hiddenLoaded = incidents.length - visibleIncidents.length;
  const isFilterLoading = loading && feed?.filter !== filter;

  return (
    <section
      aria-labelledby="live-incidents-heading"
      data-testid="live-incidents-panel"
      data-connection={effectiveHealth}
      data-paused={paused ? 'true' : 'false'}
      className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden"
    >
      <header className="flex flex-col gap-3 border-b border-border p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-200/50 dark:border-rose-900/50 flex items-center justify-center text-rose-600 shrink-0">
            <Radio className="w-4 h-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="live-incidents-heading" className="text-sm font-bold text-foreground">
                Live Incidents
              </h2>
              <Badge variant="outline" size="xs" data-testid="live-incidents-total">
                {total.toLocaleString()} active
              </Badge>
            </div>
            <p
              className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground"
              aria-live="polite"
              data-testid="live-incidents-status"
            >
              <span
                className={cn('inline-flex items-center gap-1.5 font-semibold', healthCopy.text)}
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    healthCopy.dot,
                    effectiveHealth === 'live' && !paused && 'motion-safe:animate-pulse'
                  )}
                />
                {paused ? 'Paused' : healthCopy.label}
              </span>
              <span data-testid="live-incidents-synced">{formatSyncAge(syncedAt, now)}</span>
              {syncError && (
                <span className="text-amber-700 dark:text-amber-400">Sync failed — retrying</span>
              )}
              {effectiveHealth === 'offline' && <span>Showing last known state</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter live incidents"
            className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
          >
            {LIVE_INCIDENT_FILTERS.map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                data-testid={`live-filter-${option}`}
                onClick={() => changeFilter(option)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors outline-none',
                  'focus-visible:ring-2 focus-visible:ring-primary/50',
                  filter === option
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {LIVE_INCIDENT_FILTER_LABELS[option]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={togglePaused}
            aria-pressed={paused}
            data-testid="live-pause-toggle"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-primary/50',
              paused
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                : 'border-border bg-card text-foreground hover:bg-muted'
            )}
          >
            {paused ? (
              <Play className="h-3 w-3" aria-hidden />
            ) : (
              <Pause className="h-3 w-3" aria-hidden />
            )}
            {paused ? 'Resume' : 'Pause'}
            {paused && pendingCount > 0 && (
              <span
                data-testid="live-pending-count"
                className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white"
              >
                {pendingCount} pending
              </span>
            )}
            <span className="sr-only">live updates</span>
          </button>
        </div>
      </header>

      <div className="hidden md:grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,11rem)_7.5rem_minmax(0,9rem)_3.5rem] gap-x-3 border-b border-border bg-muted/30 pl-4 pr-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Priority</span>
        <span>Incident</span>
        <span>Service</span>
        <span>Status</span>
        <span>Assignee</span>
        <span className="text-right">Age</span>
      </div>

      <div className={cn('relative', isFilterLoading && 'opacity-60')} aria-busy={isFilterLoading}>
        {feed === null && loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <RefreshCw className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
            Loading live incidents…
          </div>
        ) : feed === null ? (
          <div className="py-10 text-center text-xs text-muted-foreground" role="alert">
            Live incidents are unavailable. Retrying automatically.
          </div>
        ) : incidents.length === 0 ? (
          <div className="py-10 text-center" data-testid="live-incidents-empty">
            <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500 mb-2" aria-hidden />
            <p className="text-sm font-semibold text-foreground">No active incidents</p>
            <p className="text-xs text-muted-foreground">
              {filter === 'active'
                ? 'All clear. New incidents will appear here automatically.'
                : `Nothing matches "${LIVE_INCIDENT_FILTER_LABELS[filter]}" right now.`}
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-border"
            aria-label={`${LIVE_INCIDENT_FILTER_LABELS[filter]} incidents, newest first`}
            data-testid="live-incidents-list"
          >
            {visibleIncidents.map(incident => (
              <LiveIncidentRow
                key={incident.id}
                incident={incident}
                now={now}
                highlighted={incident.id in highlighted}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 sm:px-4">
        <span className="text-[11px] text-muted-foreground">
          Showing {visibleIncidents.length} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-2">
          {(hiddenLoaded > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded(value => !value)}
              data-testid="live-show-more"
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {expanded ? 'Show less' : `Show ${hiddenLoaded} more`}
            </button>
          )}
          <Link
            href={viewAllHref(filter, currentUserId)}
            data-testid="live-view-all"
            className="rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            View All Incidents &rarr;
          </Link>
        </div>
      </footer>
    </section>
  );
}
