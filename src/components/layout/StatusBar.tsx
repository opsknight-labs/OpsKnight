'use client';

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  CalendarX,
  DatabaseZap,
  Inbox,
  PlayCircle,
  Radio,
  Siren,
  TimerOff,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { useOptionalRealtime } from '@/hooks/useRealtime';
import { useTimezone } from '@/contexts/TimezoneContext';
import { cn } from '@/lib/utils';
import {
  EMPTY_HEALTH,
  MY_INCIDENTS_HREF,
  buildSignals,
  connectionLabel,
  connectionState,
  deriveOnCall,
  myWorkLabel,
  nextOnCallChange,
  onCallLabel,
  splitSignals,
  type ConnectionState,
  type MyIncidentCounts,
  type Signal,
  type SignalIcon,
  type SignalTone,
  type StatusBarShift,
  type WorkspaceHealth,
} from '@/lib/status-bar';

export type StatusBarProps = {
  shifts: StatusBarShift[];
  counts: MyIncidentCounts;
  health: WorkspaceHealth;
  /** Server render time, so the first client render matches the server HTML. */
  renderedAt: number;
};

const COUNTS_DEBOUNCE_MS = 2_500;
const FALLBACK_POLL_MS = 60_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const item =
  'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 transition-colors';
const interactive =
  'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const icon = 'size-3.5 shrink-0';

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

/** The single realtime stream's state; never opens a connection of its own. */
function useConnectionState(): ConnectionState {
  const realtime = useOptionalRealtime();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );
  return connectionState({
    available: realtime !== null,
    isConnected: realtime?.isConnected ?? false,
    isRevoked: realtime?.isRevoked ?? false,
    online,
    everConnected: (realtime?.connectionEpoch ?? 0) > 0,
  });
}

const OnCallItem = memo(function OnCallItem({
  shifts,
  renderedAt,
}: {
  shifts: StatusBarShift[];
  renderedAt: number;
}) {
  const { userTimeZone } = useTimezone();
  const [now, setNow] = useState(renderedAt);
  const changeAt = nextOnCallChange(shifts, now);

  // Re-derive exactly when a shift starts or ends, never by polling.
  useEffect(() => {
    if (changeAt === null) return;
    const delay = Math.min(Math.max(changeAt - Date.now(), 0) + 250, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [changeAt]);

  const state = deriveOnCall(shifts, now);
  if (!state) return null;
  const label = onCallLabel(state, now, userTimeZone);
  return (
    <Link
      href={`/schedules/${state.scheduleId}`}
      prefetch={false}
      className={cn(item, interactive, 'min-w-0')}
      title={`${label} (${state.scheduleName})`}
    >
      <CalendarClock className={icon} aria-hidden="true" />
      {state.kind === 'on' && (
        <span className="size-1.5 shrink-0 rounded-full bg-status-shift" aria-hidden="true" />
      )}
      <span className="max-w-64 truncate tabular-nums">{label}</span>
    </Link>
  );
});

/** Counts for the bar; refreshed on realtime change signals (debounced) and polled only while the stream is down. */
function useStatusBarStats(initialCounts: MyIncidentCounts, initialHealth: WorkspaceHealth) {
  const [counts, setCounts] = useState(initialCounts);
  const [health, setHealth] = useState(initialHealth);
  const realtime = useOptionalRealtime();
  const live = useConnectionState() === 'live';
  const generation = realtime?.changeGeneration ?? null;
  const seenGeneration = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Small cached endpoint (private, max-age=10, swr=30); the shell never calls sidebar-stats.
      const res = await fetch('/api/status-bar');
      if (!res.ok) return;
      const body = await res.json();
      const data = body?.data ?? body;
      const my = data?.my;
      if (typeof my?.assigned === 'number' && typeof my?.unacked === 'number')
        setCounts({ assigned: my.assigned, unacked: my.unacked });
      const h = data?.health;
      if (typeof h?.awaitingAck === 'number') setHealth({ ...EMPTY_HEALTH, ...h });
    } catch {
      // Keep the last known values; the next change or poll retries.
    }
  }, []);

  // Each (re)connect replays the current generation; only a new one means incidents changed.
  useEffect(() => {
    if (generation === null) return;
    const previous = seenGeneration.current;
    seenGeneration.current = generation;
    if (previous === null || previous === generation) return;
    const timer = setTimeout(() => void refresh(), COUNTS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [generation, refresh]);

  // Fallback only while the stream is down; skipped while the tab is hidden.
  useEffect(() => {
    if (live) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  return { counts, health };
}

function MyWorkItem({ counts }: { counts: MyIncidentCounts }) {
  const label = myWorkLabel(counts);
  if (!label) return null;
  return (
    <Link
      href={MY_INCIDENTS_HREF}
      prefetch={false}
      className={cn(item, interactive)}
      title="Open incidents assigned to me"
      aria-label={`My incidents: ${label}`}
    >
      <Inbox className={icon} aria-hidden="true" />
      <span className="tabular-nums">
        {counts.assigned} assigned ·{' '}
        <span className={cn(counts.unacked > 0 && 'font-medium text-amber-300')}>
          {counts.unacked} unacked
        </span>
      </span>
    </Link>
  );
}

function dotClass(state: ConnectionState) {
  if (state === 'live') return 'bg-status-ok';
  if (state === 'offline') return 'bg-status-critical';
  // Only a dropped connection pulses, and only when motion is welcome.
  return state === 'reconnecting'
    ? 'bg-status-elevated motion-safe:animate-pulse'
    : 'bg-status-elevated';
}

function ConnectionItem() {
  const state = useConnectionState();
  const [previous, setPrevious] = useState(state);
  const [announcement, setAnnouncement] = useState('');
  // Announce changes, but not the routine first connect on page load.
  if (state !== previous) {
    setPrevious(state);
    if (!(previous === 'connecting' && state === 'live'))
      setAnnouncement(`Realtime updates: ${connectionLabel(state)}`);
  }
  const label = connectionLabel(state);
  return (
    <span className={item} title={`Realtime updates: ${label}`}>
      <span className={cn('size-1.5 shrink-0 rounded-full', dotClass(state))} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
    </span>
  );
}

const SIGNAL_ICONS: Record<SignalIcon, typeof Wrench> = {
  ack: TriangleAlert,
  sla: TimerOff,
  coverage: CalendarX,
  maintenance: Wrench,
  warRoom: Siren,
  statusPage: Radio,
  runbook: PlayCircle,
  ingestion: DatabaseZap,
};

const TONE_CLASS: Record<SignalTone, string> = {
  critical: 'font-medium text-status-critical',
  elevated: 'font-medium text-status-elevated',
  neutral: '',
  info: 'text-status-info',
};

/** At most this many signals stay inline; the rest collapse into a "+N" popover so none is cut off. */
const MAX_INLINE_SIGNALS = 3;

function SignalItem({ signal, className }: { signal: Signal; className?: string }) {
  const Icon = SIGNAL_ICONS[signal.icon];
  const body = (
    <>
      <Icon className={icon} aria-hidden="true" />
      <span className="max-w-56 truncate tabular-nums">{signal.label}</span>
    </>
  );
  const common = cn(item, TONE_CLASS[signal.tone], className);
  const name = `${signal.label}: ${signal.detail}`;
  return signal.href ? (
    <Link
      href={signal.href}
      prefetch={false}
      className={cn(common, interactive)}
      title={signal.detail}
      aria-label={name}
    >
      {body}
    </Link>
  ) : (
    <span className={common} title={signal.detail} aria-label={name} role="group">
      {body}
    </span>
  );
}

function Signals({ health }: { health: WorkspaceHealth }) {
  const { userTimeZone } = useTimezone();
  const { inline, overflow } = splitSignals(buildSignals(health, userTimeZone), MAX_INLINE_SIGNALS);
  return (
    <>
      {inline.map(signal => (
        <SignalItem key={signal.key} signal={signal} />
      ))}
      {overflow.length > 0 && (
        <Popover>
          <PopoverTrigger
            className={cn(item, interactive, 'font-medium')}
            aria-label={`${overflow.length} more active signals`}
            title={overflow.map(signal => signal.label).join(' · ')}
          >
            <span className="tabular-nums">+{overflow.length}</span>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-auto min-w-56 p-1 text-xs">
            <ul className="flex flex-col">
              {overflow.map(signal => (
                <li key={signal.key}>
                  <SignalItem signal={signal} className="h-7 w-full" />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

/** Desktop console status bar (lg+), beside the sidebar: on-call, my work; live connection and active signals.
 *  The site link and app version live only in the sidebar footer. */
export default function StatusBar({ shifts, counts, health, renderedAt }: StatusBarProps) {
  const stats = useStatusBarStats(counts, health);
  return (
    <footer
      id="status-bar"
      aria-label="Status bar"
      className="status-bar ok-inverse-surface fixed bottom-0 right-0 z-40 hidden h-7 select-none items-center gap-1 border-t border-border bg-background px-2 text-xs text-muted-foreground lg:flex"
    >
      <OnCallItem shifts={shifts} renderedAt={renderedAt} />
      <MyWorkItem counts={stats.counts} />
      <span className="flex-1" />
      <ConnectionItem />
      <Signals health={stats.health} />
    </footer>
  );
}
