'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownWideNarrow,
  ArrowRight,
  CheckCircle2,
  Download,
  Keyboard,
  Monitor,
  MoreHorizontal,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import { useToast } from '@/hooks/use-product-notification';
import { reassignIncident, updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  LIVE_INCIDENT_VISIBLE_ROWS,
  LIVE_MAX_PINS,
  countActiveFacets,
  liveQueryKey,
  liveViewLabel,
  type LiveConnectionHealth,
  type LiveIncident,
  type LiveIncidentQuery,
  type LiveSort,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard, type LiveDensity } from './LiveDashboardProvider';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { LIVE_ROW_GRID, LIVE_ROW_GRID_TV, LiveIncidentRow } from './LiveIncidentRow';
import { LiveActiveFilters, LiveToolbar, type LiveDirectoryOption } from './LiveFilterBar';
import { enterFullscreen, isFullscreenSupported } from '@/lib/fullscreen';

function healthCopy(health: LiveConnectionHealth): { label: string; dot: string; text: string } {
  switch (health) {
    case 'live':
      return {
        label: 'Live',
        dot: 'bg-emerald-500',
        text: 'text-emerald-700 dark:text-emerald-400',
      };
    case 'stale':
      return { label: 'Stale', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' };
    case 'offline':
      return { label: 'Offline', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' };
    case 'revoked':
      return {
        label: 'Session expired',
        dot: 'bg-rose-500',
        text: 'text-rose-700 dark:text-rose-400',
      };
    case 'connecting':
    default:
      return { label: 'Connecting', dot: 'bg-slate-400', text: 'text-muted-foreground' };
  }
}

const SHORTCUTS: Array<[string, string]> = [
  ['j / k', 'Next / previous incident'],
  ['Enter', 'Open the focused incident'],
  ['o / Space', 'Inspect focused incident'],
  ['a', 'Acknowledge focused incident'],
  ['m', 'Assign focused incident to me'],
  ['/', 'Search live incidents'],
  ['p', 'Pause / resume live updates'],
  ['Esc', 'Close details inspector'],
];

export function viewAllHref(query: LiveIncidentQuery, currentUserId: string): string {
  const scopeParams =
    query.scope === 'mine'
      ? { assignee: currentUserId }
      : query.scope === 'teams'
        ? { teamId: query.teamId ?? 'mine' }
        : {};

  const base = {
    ...scopeParams,
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
    setQuery,
    pins,
    togglePin,
    density,
    setDensity,
    selectedIncidentId,
    selectIncident,
  } = live;
  const wallboard = variant === 'wallboard';
  // Desktop cockpit: the panel is viewport-sized and scrolls internally, so render every loaded
  // row. Phones keep a short list with "Show more" to avoid a very long page.
  const fill = useMediaQuery('(min-width: 1280px)') || wallboard;
  const [expanded, setExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<string, 'ack' | 'assign'>>({});
  const listRef = useRef<HTMLUListElement | null>(null);

  const visible = useMemo(
    () => (fill || expanded ? incidents : incidents.slice(0, LIVE_INCIDENT_VISIBLE_ROWS)),
    [expanded, fill, incidents]
  );
  const hiddenLoaded = incidents.length - visible.length;
  const facetCount = countActiveFacets(query);
  const health_ = healthCopy(health);
  const isQueryLoading = loading && snapshot !== null;

  // Reset keyboard focus whenever the query changes.
  const [focusQueryKey, setFocusQueryKey] = useState(() => liveQueryKey(query));
  if (focusQueryKey !== liveQueryKey(query)) {
    setFocusQueryKey(liveQueryKey(query));
    setFocusedIndex(null);
  }

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
      const focused =
        focusedIndex !== null ? visible.slice(focusedIndex, focusedIndex + 1)[0] : undefined;
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
          document.getElementById('live-incident-search')?.focus();
          return;
        case 'p':
          event.preventDefault();
          togglePaused();
          return;
        case 'o':
        case ' ':
          if (focused && !wallboard) {
            event.preventDefault();
            selectIncident(selectedIncidentId === focused.id ? null : focused.id);
          }
          return;
        case 'Escape':
          if (selectedIncidentId) {
            event.preventDefault();
            selectIncident(null);
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
    selectIncident,
    selectedIncidentId,
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

  const statusLine = (
    <p
      className="flex min-w-0 items-center gap-x-2 truncate text-[11px] text-muted-foreground"
      aria-live="polite"
      data-testid="live-incidents-status"
    >
      <span className={cn('inline-flex items-center gap-1.5 font-semibold', health_.text)}>
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            health_.dot,
            health === 'live' && !paused && 'motion-safe:animate-pulse'
          )}
        />
        {paused ? 'Paused' : health_.label}
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
  );

  return (
    <section
      aria-labelledby="live-incidents-heading"
      data-testid="live-incidents-panel"
      data-connection={health}
      data-paused={paused ? 'true' : 'false'}
      data-loading={loading ? 'true' : 'false'}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
    >
      <header
        className={
          wallboard ? 'sr-only' : 'shrink-0 space-y-2 border-b border-border px-3 py-2.5 sm:px-4'
        }
      >
        {wallboard ? (
          <h2 id="live-incidents-heading" className="sr-only">
            Live Incidents
          </h2>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  health === 'live' && !paused
                    ? 'bg-rose-500 motion-safe:animate-pulse'
                    : 'bg-slate-400'
                )}
              />
              <h2 id="live-incidents-heading" className="dash-heading whitespace-nowrap">
                Live Incidents
              </h2>
              <Badge
                variant="outline"
                size="xs"
                data-testid="live-incidents-total"
                className="tabular-nums"
              >
                {query.view === 'active' && facetCount === 0
                  ? `${total.toLocaleString()} active`
                  : `${total.toLocaleString()} of ${(snapshot?.summary.active ?? total).toLocaleString()}`}
              </Badge>
            </div>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <LiveToolbar services={services} teams={teams} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="live-sort"
                    className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 text-xs font-medium shadow-2xs hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <ArrowDownWideNarrow className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {query.sort === 'attention' ? 'Needs attention' : 'Newest'}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Sort
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={query.sort}
                    onValueChange={value => setQuery({ sort: value as LiveSort })}
                  >
                    <DropdownMenuRadioItem value="newest" data-testid="live-sort-newest">
                      Newest first
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="attention" data-testid="live-sort-attention">
                      Needs attention first
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
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
                  <Play className="h-3 w-3 shrink-0" aria-hidden />
                ) : (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"
                  />
                )}
                {paused ? 'Paused' : 'Live'}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="live-more-actions"
                    aria-label="More live incident actions"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card p-0 text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Row density
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={density}
                    onValueChange={value => setDensity(value as LiveDensity)}
                  >
                    <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="compact" data-testid="live-density-compact">
                      Compact
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={refresh} data-testid="live-refresh">
                    <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                    Refresh now
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={criticalAlerts}
                    onCheckedChange={checked => setCriticalAlerts(checked === true)}
                    data-testid="live-alerts-toggle"
                  >
                    Alert me about new critical incidents
                  </DropdownMenuCheckboxItem>
                  {canExport && (
                    <DropdownMenuItem
                      onSelect={exportCsv}
                      disabled={incidents.length === 0}
                      data-testid="live-export"
                    >
                      <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                      Export loaded incidents (CSV)
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link
                      href="/wallboard"
                      onClick={() => {
                        if (isFullscreenSupported()) {
                          void enterFullscreen(document.documentElement).catch(() => {});
                        }
                      }}
                    >
                      <Monitor className="mr-2 h-3.5 w-3.5" aria-hidden />
                      Open Operations Console (TV mode)
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Keyboard className="h-3 w-3" aria-hidden />
                    Shortcuts
                  </DropdownMenuLabel>
                  {SHORTCUTS.map(([keys, description]) => (
                    <div
                      key={keys}
                      className="flex items-center justify-between gap-3 px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      <span>{description}</span>
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        {!wallboard && <LiveActiveFilters services={services} teams={teams} />}
      </header>

      {!wallboard && snapshot && snapshot.pinned.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border/70 bg-muted/30 px-4 py-1.5 [scrollbar-width:none]"
          data-testid="live-pinned"
        >
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pinned {snapshot.pinned.length}/{LIVE_MAX_PINS}
          </span>
          {snapshot.pinned.map(item => (
            <span
              key={item.id}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card py-0.5 pl-2 pr-1 text-[11px] font-medium shadow-2xs"
            >
              <Link
                href={`/incidents/${item.id}`}
                className="max-w-[16rem] truncate hover:text-primary"
              >
                <span
                  className={cn(
                    'mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle',
                    item.status === 'OPEN' ? 'bg-rose-500' : 'bg-amber-500'
                  )}
                  aria-hidden
                />
                {item.title}
              </Link>
              <button
                type="button"
                onClick={() => togglePin(item.id)}
                aria-label={`Unpin ${item.title}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        aria-hidden
        className={cn(
          'hidden shrink-0 border-b border-border bg-muted/40 py-1.5 pl-4 pr-3 font-semibold uppercase tracking-wider text-muted-foreground md:grid',
          wallboard ? 'gap-x-4 text-[0.7em]' : 'gap-x-2.5 text-[10px]',
          wallboard ? LIVE_ROW_GRID_TV : LIVE_ROW_GRID
        )}
      >
        <span>Prio / Urg</span>
        <span>Incident</span>
        <span>Status</span>
        <span>SLA</span>
        <span>Assignee</span>
        {!wallboard && <span className="text-right">Actions</span>}
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-y-auto overscroll-contain transition-opacity',
          isQueryLoading && 'opacity-60'
        )}
        aria-busy={isQueryLoading}
        data-testid="live-incidents-scroll"
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
          <div
            className="flex h-full min-h-[12rem] flex-col items-center justify-center py-10 text-center"
            data-testid="live-incidents-empty"
          >
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-foreground">
              {query.view === 'active' && facetCount === 0
                ? 'No active incidents'
                : 'Nothing matches'}
            </p>
            <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">
              {query.view === 'active' && facetCount === 0
                ? 'All clear. New incidents will appear here automatically.'
                : `No active incidents match “${liveViewLabel(query.view)}”${facetCount ? ' with these filters' : ''}.`}
            </p>
          </div>
        ) : (
          <ul
            ref={listRef}
            className="divide-y divide-border/70"
            aria-label={`${liveViewLabel(query.view)} incidents, newest first`}
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
                isSelected={selectedIncidentId === incident.id}
                canAcknowledge={canAcknowledge && !wallboard}
                canAssignSelf={canAssignSelf && !wallboard}
                isMine={incident.assignee?.id === currentUserId}
                busy={busy[incident.id] ?? null}
                onAcknowledge={acknowledge}
                onAssignSelf={assignSelf}
                onFocusRow={setFocusedIndex}
                onSelectRow={item =>
                  selectIncident(selectedIncidentId === item.id ? null : item.id)
                }
                tv={wallboard}
                density={density}
                pinned={pins.includes(incident.id)}
                onTogglePin={togglePin}
              />
            ))}
          </ul>
        )}
      </div>

      {!wallboard && (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              Showing {visible.length} of {total.toLocaleString()}
            </span>
            <span className="hidden sm:block">{statusLine}</span>
          </div>
          <div className="flex items-center gap-2">
            {!fill && (hiddenLoaded > 0 || expanded) && (
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
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              View all incidents
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            </Link>
          </div>
        </footer>
      )}
    </section>
  );
}
