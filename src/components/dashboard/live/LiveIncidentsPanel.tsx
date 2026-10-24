'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  Keyboard,
  Pause,
  Play,
  Radio,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { useToast } from '@/hooks/use-product-notification';
import { reassignIncident, updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  LIVE_INCIDENT_VISIBLE_ROWS,
  LIVE_VIEW_LABELS,
  countActiveFacets,
  type LiveConnectionHealth,
  type LiveIncident,
  type LiveIncidentQuery,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';
import { LIVE_ROW_GRID, LIVE_ROW_GRID_TV, LiveIncidentRow } from './LiveIncidentRow';
import { LiveFilterBar, LiveViewTabs, type LiveDirectoryOption } from './LiveFilterBar';

const HEALTH_COPY: Record<LiveConnectionHealth, { label: string; dot: string; text: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  connecting: { label: 'Connecting', dot: 'bg-slate-400', text: 'text-muted-foreground' },
  stale: { label: 'Stale', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  offline: { label: 'Offline', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  revoked: {
    label: 'Session expired',
    dot: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
  },
};

const SHORTCUTS: Array<[string, string]> = [
  ['j / k', 'Next / previous incident'],
  ['Enter', 'Open focused incident'],
  ['a', 'Acknowledge focused incident'],
  ['m', 'Assign focused incident to me'],
  ['/', 'Search live incidents'],
  ['p', 'Pause / resume live updates'],
];

export function viewAllHref(query: LiveIncidentQuery, currentUserId: string): string {
  const base = {
    ...(query.serviceId ? { serviceId: query.serviceId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.urgency !== 'all' ? { urgency: query.urgency } : {}),
    ...(query.search ? { search: query.search } : {}),
  };
  const status =
    query.status !== 'all' ? { status: query.status } : { filter: 'all_open' as const };
  switch (query.view) {
    case 'critical':
      return buildIncidentListHref({ ...base, filter: 'critical_focus' });
    case 'mine':
      return buildIncidentListHref({ ...base, ...status, assignee: currentUserId });
    case 'my_teams':
      return buildIncidentListHref({ ...base, ...status, teamId: query.teamId ?? 'mine' });
    case 'unassigned':
      return buildIncidentListHref({ ...base, ...status, assignee: 'unassigned' });
    default:
      return buildIncidentListHref({
        ...base,
        ...status,
        ...(query.assignment === 'unassigned' ? { assignee: 'unassigned' } : {}),
      });
  }
}

export function formatSyncAge(syncedAt: number | null, now: number): string {
  if (syncedAt === null) return 'Not synced yet';
  const seconds = Math.max(0, Math.round((now - syncedAt) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable ||
    element.closest('[role="dialog"],[role="listbox"],[role="menu"]') !== null
  );
}

export default function LiveIncidentsPanel({
  services,
  teams,
  canAcknowledge,
  canAssignSelf,
  canExport,
  currentUserName,
  variant = 'default',
}: {
  services: LiveDirectoryOption[];
  teams: LiveDirectoryOption[];
  canAcknowledge: boolean;
  canAssignSelf: boolean;
  canExport: boolean;
  currentUserName: string;
  variant?: 'default' | 'wallboard';
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const live = useLiveDashboard();
  const {
    query,
    incidents,
    total,
    snapshot,
    loading,
    syncError,
    syncedAt,
    health,
    paused,
    togglePaused,
    pendingCount,
    highlighted,
    now,
    applyOptimistic,
    refresh,
    currentUserId,
    criticalAlerts,
    setCriticalAlerts,
  } = live;
  const wallboard = variant === 'wallboard';
  const [expanded, setExpanded] = useState(wallboard);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<string, 'ack' | 'assign'>>({});
  const listRef = useRef<HTMLUListElement | null>(null);

  const visible = useMemo(
    () => (expanded ? incidents : incidents.slice(0, LIVE_INCIDENT_VISIBLE_ROWS)),
    [expanded, incidents]
  );
  const hiddenLoaded = incidents.length - visible.length;
  const facetCount = countActiveFacets(query);
  const healthCopy = HEALTH_COPY[health];
  const isQueryLoading = loading && snapshot !== null;

  useEffect(() => setFocusedIndex(null), [query]);

  const acknowledge = useCallback(
    async (incident: LiveIncident) => {
      if (busy[incident.id]) return;
      setBusy(current => ({ ...current, [incident.id]: 'ack' }));
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
        setBusy(current => {
          const next = { ...current };
          delete next[incident.id];
          return next;
        });
      }
    },
    [applyOptimistic, busy, refresh, showToast]
  );

  const assignSelf = useCallback(
    async (incident: LiveIncident) => {
      if (busy[incident.id]) return;
      setBusy(current => ({ ...current, [incident.id]: 'assign' }));
      const rollback = applyOptimistic(incident.id, {
        assignee: { id: currentUserId, name: currentUserName },
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
        setBusy(current => {
          const next = { ...current };
          delete next[incident.id];
          return next;
        });
      }
    },
    [applyOptimistic, busy, currentUserId, currentUserName, refresh, showToast]
  );

  const focusRow = useCallback((index: number) => {
    setFocusedIndex(index);
    listRef.current
      ?.querySelector<HTMLAnchorElement>(`[data-live-row-link="${index}"]`)
      ?.focus({ preventScroll: false });
  }, []);

  // Panel-scoped shortcuts. Ignores typing targets and the global "g <key>" navigation chord.
  const gPressedAt = useRef(0);
  useEffect(() => {
    if (wallboard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key;
      if (key.toLowerCase() === 'g') {
        gPressedAt.current = Date.now();
        return;
      }
      if (Date.now() - gPressedAt.current < 1_500) {
        gPressedAt.current = 0;
        return;
      }
      const focused = focusedIndex !== null ? visible[focusedIndex] : undefined;
      switch (key) {
        case 'j':
          event.preventDefault();
          if (visible.length)
            focusRow(focusedIndex === null ? 0 : Math.min(focusedIndex + 1, visible.length - 1));
          return;
        case 'k':
          event.preventDefault();
          if (visible.length) focusRow(focusedIndex === null ? 0 : Math.max(focusedIndex - 1, 0));
          return;
        case 'a':
          if (focused && canAcknowledge && focused.status === 'OPEN') {
            event.preventDefault();
            void acknowledge(focused);
          }
          return;
        case 'm':
          if (focused && canAssignSelf && focused.assignee?.id !== currentUserId) {
            event.preventDefault();
            void assignSelf(focused);
          }
          return;
        case '/':
          event.preventDefault();
          setFiltersOpen(true);
          requestAnimationFrame(() => document.getElementById('live-incident-search')?.focus());
          return;
        case 'p':
          event.preventDefault();
          togglePaused();
          return;
        case 'Enter':
          if (focused && !(event.target instanceof HTMLAnchorElement)) {
            event.preventDefault();
            router.push(`/incidents/${focused.id}`);
          }
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    acknowledge,
    assignSelf,
    canAcknowledge,
    canAssignSelf,
    currentUserId,
    focusRow,
    focusedIndex,
    router,
    togglePaused,
    visible,
    wallboard,
  ]);

  const exportCsv = () => {
    const header = [
      'ID',
      'Priority',
      'Urgency',
      'Title',
      'Service',
      'Team',
      'Status',
      'Assignee',
      'SLA',
      'Created',
    ];
    const rows = incidents.map(incident => [
      incident.id,
      incident.priority ?? '',
      incident.urgency,
      incident.title,
      incident.service.name,
      incident.team?.name ?? '',
      incident.status,
      incident.assignee?.name ?? 'Unassigned',
      incident.sla.warning,
      incident.createdAt,
    ]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `opsknight-live-incidents-${new Date().toISOString().slice(0, 19)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-labelledby="live-incidents-heading"
      data-testid="live-incidents-panel"
      data-connection={health}
      data-paused={paused ? 'true' : 'false'}
      className={cn(
        'rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col',
        wallboard && 'h-full'
      )}
    >
      <header className="space-y-3 border-b border-border p-3 sm:p-4">
        {/* The wallboard has its own header; keep this one for assistive tech only. */}
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2',
            wallboard && 'sr-only'
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200/50 bg-rose-500/10 text-rose-600 dark:border-rose-900/50">
              <Radio className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="live-incidents-heading"
                  className={cn('font-bold text-foreground', wallboard ? 'text-xl' : 'text-sm')}
                >
                  Live Incidents
                </h2>
                <Badge variant="outline" size="xs" data-testid="live-incidents-total">
                  {total.toLocaleString()}{' '}
                  {query.view === 'active' && facetCount === 0 ? 'active' : 'matching'}
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
                      health === 'live' && !paused && 'motion-safe:animate-pulse'
                    )}
                  />
                  {paused ? 'Paused' : healthCopy.label}
                </span>
                <span data-testid="live-incidents-synced">{formatSyncAge(syncedAt, now)}</span>
                {syncError && (
                  <span className="text-amber-700 dark:text-amber-400">Sync failed — retrying</span>
                )}
                {health === 'offline' && <span>Showing last known state</span>}
                {snapshot?.truncated && (
                  <span>Showing newest {snapshot.summary.active.toLocaleString()}</span>
                )}
              </p>
            </div>
          </div>

          {!wallboard && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={togglePaused}
                aria-pressed={paused}
                data-testid="live-pause-toggle"
                title="Pause / resume live updates (p)"
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
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
              <button
                type="button"
                onClick={() => setCriticalAlerts(!criticalAlerts)}
                aria-pressed={criticalAlerts}
                data-testid="live-alerts-toggle"
                title={
                  criticalAlerts
                    ? 'Critical alerts on (background tab)'
                    : 'Alert me about new critical incidents'
                }
                className={cn(
                  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  criticalAlerts
                    ? 'border-rose-400/60 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {criticalAlerts ? (
                  <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span className="sr-only">Critical incident alerts</span>
              </button>
              <button
                type="button"
                onClick={refresh}
                title="Refresh now"
                data-testid="live-refresh"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border p-0 border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    isQueryLoading && 'motion-safe:animate-spin'
                  )}
                  aria-hidden
                />
                <span className="sr-only">Refresh live incidents</span>
              </button>
              {canExport && (
                <button
                  type="button"
                  onClick={exportCsv}
                  title="Export loaded incidents as CSV"
                  data-testid="live-export"
                  disabled={incidents.length === 0}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border p-0 border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">Export CSV</span>
                </button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Keyboard shortcuts"
                    className="hidden md:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border p-0 border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="sr-only">Keyboard shortcuts</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-3">
                  <p className="mb-2 text-xs font-bold text-foreground">Live incident shortcuts</p>
                  <dl className="space-y-1">
                    {SHORTCUTS.map(([keys, description]) => (
                      <div
                        key={keys}
                        className="flex items-center justify-between gap-3 text-[11px]"
                      >
                        <dt className="text-muted-foreground">{description}</dt>
                        <dd>
                          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                            {keys}
                          </kbd>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <LiveViewTabs />
          {!wallboard && (
            <button
              type="button"
              onClick={() => setFiltersOpen(open => !open)}
              aria-expanded={filtersOpen || facetCount > 0}
              aria-controls="live-filter-region"
              data-testid="live-filters-toggle"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                facetCount > 0
                  ? 'border-primary/50 bg-primary/5 text-primary'
                  : 'border-border bg-card text-foreground hover:bg-muted'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Filters{facetCount > 0 ? ` · ${facetCount}` : ''}
            </button>
          )}
        </div>
        {!wallboard && (filtersOpen || facetCount > 0) && (
          <div id="live-filter-region">
            <LiveFilterBar services={services} teams={teams} />
          </div>
        )}
      </header>

      <div
        aria-hidden
        className={cn(
          'hidden md:grid gap-x-2.5 border-b border-border bg-muted/30 pl-4 pr-3 py-1.5 font-semibold uppercase tracking-wider text-muted-foreground',
          wallboard ? 'md:gap-x-4 text-[0.7em]' : 'text-[10px]',
          wallboard ? LIVE_ROW_GRID_TV : LIVE_ROW_GRID
        )}
      >
        <span>Prio</span>
        <span>Incident</span>
        <span>Status</span>
        <span>SLA</span>
        <span>Assignee</span>
        {!wallboard && <span className="text-right">Actions</span>}
      </div>

      <div
        className={cn(
          'relative flex-1',
          isQueryLoading && 'opacity-60',
          wallboard && 'overflow-y-auto'
        )}
        aria-busy={isQueryLoading}
      >
        {snapshot === null && loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <RefreshCw className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
            Loading live incidents…
          </div>
        ) : snapshot === null ? (
          <div className="py-10 text-center text-xs text-muted-foreground" role="alert">
            Live incidents are unavailable. Retrying automatically.
          </div>
        ) : incidents.length === 0 ? (
          <div className="py-10 text-center" data-testid="live-incidents-empty">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" aria-hidden />
            <p className="text-sm font-semibold text-foreground">
              {query.view === 'active' && facetCount === 0
                ? 'No active incidents'
                : 'Nothing matches'}
            </p>
            <p className="text-xs text-muted-foreground">
              {query.view === 'active' && facetCount === 0
                ? 'All clear. New incidents will appear here automatically.'
                : `No active incidents match “${LIVE_VIEW_LABELS[query.view]}”${facetCount ? ' with these filters' : ''}.`}
            </p>
          </div>
        ) : (
          <ul
            ref={listRef}
            className="divide-y divide-border"
            aria-label={`${LIVE_VIEW_LABELS[query.view]} incidents, newest first`}
            data-testid="live-incidents-list"
          >
            {visible.map((incident, index) => (
              <LiveIncidentRow
                key={incident.id}
                incident={incident}
                index={index}
                now={now}
                highlighted={highlighted.has(incident.id)}
                focused={focusedIndex === index}
                canAcknowledge={canAcknowledge && !wallboard}
                canAssignSelf={canAssignSelf && !wallboard}
                isMine={incident.assignee?.id === currentUserId}
                busy={busy[incident.id] ?? null}
                onAcknowledge={acknowledge}
                onAssignSelf={assignSelf}
                onFocusRow={setFocusedIndex}
                tv={wallboard}
              />
            ))}
          </ul>
        )}
      </div>

      {!wallboard && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 sm:px-4">
          <span className="text-[11px] text-muted-foreground">
            Showing {visible.length} of {total.toLocaleString()}
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
              href={viewAllHref(query, currentUserId)}
              data-testid="live-view-all"
              className="rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              View All Incidents &rarr;
            </Link>
          </div>
        </footer>
      )}
    </section>
  );
}
