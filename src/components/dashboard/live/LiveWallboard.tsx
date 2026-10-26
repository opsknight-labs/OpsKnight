'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  WifiOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveClock from '@/components/dashboard/LiveClock';
import {
  FULLSCREEN_CHANGE_EVENTS,
  enterFullscreen,
  exitFullscreen,
  getFullscreenElement,
  isFullscreenSupported,
} from '@/lib/fullscreen';
import { liveViewLabel } from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';
import LiveIncidentsPanel, { formatSyncAge } from './LiveIncidentsPanel';
import { OnCallCard, SlaRiskCard } from './ResponderRail';
import { buildInsight } from './LiveCommandStrip';

const CYCLE_MS = 20_000;
const IDLE_HIDE_MS = 6_000;
const BURN_IN_SHIFT_MS = 3 * 60_000;
/** Kiosk safety net: a periodic full reload clears long-running browser memory growth. */
const KIOSK_RELOAD_MS = 12 * 60 * 60_000;
const SCALE_STORAGE_KEY = 'opsknight:wallboard:scale:v1';
const SCALE_STEPS = [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.75, 2] as const;

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

/** Keeps the TV awake while the wallboard is visible (re-acquired after tab switches). */
function useScreenWakeLock() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await wakeLock.request('screen');
        if (cancelled) void sentinel.release();
        else setActive(true);
      } catch {
        setActive(false);
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release();
    };
  }, []);
  return active;
}

/** Hides controls and the cursor after a few idle seconds; any key or pointer wakes them. */
function useIdle(timeoutMs: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), timeoutMs);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), timeoutMs);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'focusin'] as const;
    for (const event of events) window.addEventListener(event, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [timeoutMs]);
  return idle;
}

function burnInOffset(step: number): [number, number] {
  switch (step) {
    case 1:
      return [2, 1];
    case 2:
      return [1, 2];
    case 3:
      return [-1, 1];
    default:
      return [0, 0];
  }
}

/** Snaps any requested scale to the closest supported step. */
function normalizeScale(value: number): number {
  return SCALE_STEPS.reduce(
    (best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best),
    1 as number
  );
}

function stepScale(current: number, delta: number): number {
  const index = SCALE_STEPS.findIndex(step => step === current);
  const next = Math.min(SCALE_STEPS.length - 1, Math.max(0, index + delta));
  return SCALE_STEPS.slice(next, next + 1)[0] ?? 1;
}

const scaleListeners = new Set<() => void>();
function subscribeScale(onChange: () => void) {
  scaleListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    scaleListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}
function readStoredScale(): number | null {
  try {
    const value = Number(window.localStorage.getItem(SCALE_STORAGE_KEY));
    return value > 0 ? value : null;
  } catch {
    // Storage may be disabled on locked-down TV browsers.
    return null;
  }
}

const controlClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-zinc-800 outline-none focus-visible:ring-4 focus-visible:ring-sky-400/70';

export default function LiveWallboard({ timeZone }: { timeZone: string }) {
  const { snapshot, query, setQuery, health, syncedAt, now } = useLiveDashboard();
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // `?cycle=off` pins a TV to one view (e.g. a team board using ?lteam=...).
  const [cycle, setCycle] = useState(searchParams.get('cycle') !== 'off');
  const [cycleStartedAt, setCycleStartedAt] = useState(() =>
    snapshot ? Date.parse(snapshot.asOf) : 0
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenHint, setFullscreenHint] = useState(false);
  // A `?scale=` URL pins the size for that screen; otherwise the per-screen stored choice wins.
  const urlScale = Number(searchParams.get('scale')) || null;
  const storedScale = useSyncExternalStore(subscribeScale, readStoredScale, () => null);
  const [shift, setShift] = useState(0);
  const wakeLockActive = useScreenWakeLock();
  const idle = useIdle(IDLE_HIDE_MS);
  const healthRef = useRef(health);
  useEffect(() => {
    healthRef.current = health;
  }, [health]);

  const summary = snapshot?.summary ?? null;
  const insight = buildInsight(summary);
  const hasCritical = (summary?.critical ?? 0) > 0;
  const degraded = health !== 'live';
  const [scaleOverride, setScaleOverride] = useState<number | null>(null);
  const scale = normalizeScale(scaleOverride ?? urlScale ?? storedScale ?? 1);

  const changeScale = useCallback(
    (delta: number) => {
      const next = stepScale(scale, delta);
      setScaleOverride(next);
      try {
        window.localStorage.setItem(SCALE_STORAGE_KEY, String(next));
      } catch {
        // Best-effort preference.
      }
      scaleListeners.forEach(notify => notify());
    },
    [scale]
  );

  // The board is dark regardless of the app theme; also paint the page behind any TV overscan.
  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#050507';
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, []);

  // Alternate Critical and All Active only while critical incidents exist; facets are preserved.
  useEffect(() => {
    if (!cycle) return;
    const timer = window.setInterval(() => {
      setCycleStartedAt(Date.now());
      if (!hasCritical) {
        if (query.view !== 'active') setQuery({ view: 'active' }, { persist: false });
        return;
      }
      setQuery({ view: query.view === 'critical' ? 'active' : 'critical' }, { persist: false });
    }, CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [cycle, hasCritical, query.view, setQuery]);

  useEffect(() => {
    const onChange = () => {
      const active = getFullscreenElement() !== null;
      setFullscreen(active);
      if (active) setFullscreenHint(false);
    };
    onChange();
    for (const event of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(event, onChange);
    return () => {
      for (const event of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(event, onChange);
    };
  }, []);

  // Burn-in protection: drift the whole board by a couple of pixels every few minutes.
  useEffect(() => {
    const timer = window.setInterval(() => setShift(value => (value + 1) % 4), BURN_IN_SHIFT_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Only reload while healthy, so a network outage never turns into a blank screen.
      if (healthRef.current === 'live') window.location.reload();
    }, KIOSK_RELOAD_MS);
    return () => window.clearInterval(timer);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (getFullscreenElement()) {
      await exitFullscreen();
      setFullscreen(false);
      setFullscreenHint(false);
      return;
    }
    const target = rootRef.current;
    if (!target) return;
    const entered = isFullscreenSupported() ? await enterFullscreen(target) : false;
    if (entered) {
      setFullscreen(true);
      setFullscreenHint(false);
    } else {
      setFullscreen(false);
      setFullscreenHint(true);
    }
  }, []);

  // Keyboard and TV-remote shortcuts (the global app shortcuts are not mounted on this route).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        changeScale(1);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        changeScale(-1);
      } else if (event.key === ' ' && event.target === document.body) {
        event.preventDefault();
        setCycle(value => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeScale, toggleFullscreen]);

  const [offsetX, offsetY] = burnInOffset(shift);
  const counters: Array<{ label: string; value: number | undefined; tone: string }> = [
    { label: 'Triggered', value: summary?.triggered, tone: 'text-rose-400' },
    { label: 'Critical', value: summary?.critical, tone: 'text-rose-400' },
    { label: 'Acknowledged', value: summary?.acknowledged, tone: 'text-amber-300' },
    { label: 'Unassigned', value: summary?.unassigned, tone: 'text-amber-300' },
    { label: 'SLA breached', value: summary?.slaBreached, tone: 'text-rose-400' },
  ];
  const cycleProgress =
    cycle && cycleStartedAt > 0 ? Math.min(1, Math.max(0, (now - cycleStartedAt) / CYCLE_MS)) : 0;

  return (
    <div
      ref={rootRef}
      data-testid="wallboard"
      data-fullscreen={fullscreen ? 'true' : 'false'}
      data-wake-lock={wakeLockActive ? 'on' : 'off'}
      // Explicit edges instead of `inset` and dvh with a vh fallback keep older TV engines happy.
      className={cn(
        'dark fixed left-0 top-0 z-[70] h-screen w-screen overflow-hidden bg-[#050507] text-foreground',
        'supports-[height:100dvh]:h-[100dvh]',
        idle && 'cursor-none'
      )}
      style={{ colorScheme: 'dark' }}
    >
      <div
        className="flex h-full flex-col p-[1.5vw] transition-transform duration-[2000ms]"
        style={{
          transform: `translate(${offsetX}px, ${offsetY}px)`,
          // `zoom` keeps layout and text crisp; supported by Chromium, Safari and Firefox 126+.
          zoom: scale,
        }}
      >
        {degraded && (
          <div
            role="alert"
            data-testid="wallboard-degraded"
            className="mb-[1.2vh] flex items-center gap-3 rounded-xl border border-rose-500/60 bg-rose-950/70 px-5 py-3 text-[clamp(14px,1.1vw,28px)] font-semibold text-rose-100"
          >
            {health === 'offline' ? (
              <WifiOff className="h-[1.4em] w-[1.4em] shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-[1.4em] w-[1.4em] shrink-0" aria-hidden />
            )}
            {health === 'revoked'
              ? 'Session expired — sign in on this screen to resume the live wallboard.'
              : health === 'connecting'
                ? 'Connecting to live updates…'
                : `Live updates interrupted — data may be out of date (${formatSyncAge(syncedAt, now).toLowerCase()}). Reconnecting automatically.`}
          </div>
        )}

        <header className="mb-[1.2vh] flex flex-wrap items-center justify-between rounded-2xl border border-zinc-800 bg-gradient-to-b from-[#121216] to-[#09090b] px-[1.5vw] py-[1.2vh] text-slate-100">
          <div className="mr-[2vw] min-w-0">
            <div className="flex items-center">
              <h1 className="dash-wallboard-title mr-4">Operations Console</h1>
              <LiveClock timeZone={timeZone} />
            </div>
            <p
              className={cn(
                'mt-1 text-[clamp(13px,1vw,28px)] font-medium',
                insight.tone === 'rose'
                  ? 'text-rose-300'
                  : insight.tone === 'emerald'
                    ? 'text-emerald-300'
                    : 'text-amber-300'
              )}
            >
              {insight.text}
            </p>
          </div>
          <dl className="flex flex-wrap" data-testid="wallboard-counters">
            {counters.map(counter => (
              <div key={counter.label} className="mx-[1.1vw] text-center">
                <dd
                  className={cn(
                    'text-[clamp(28px,3.2vw,96px)] font-extrabold leading-none tabular-nums',
                    counter.value ? counter.tone : 'text-white'
                  )}
                >
                  {counter.value ?? '—'}
                </dd>
                <dt className="mt-1 text-[clamp(10px,0.75vw,20px)] font-semibold uppercase tracking-wider text-slate-400">
                  {counter.label}
                </dt>
              </div>
            ))}
          </dl>
          <div
            role="toolbar"
            aria-label="Wallboard controls"
            className={cn(
              'flex flex-wrap items-center gap-2 transition-opacity duration-500',
              idle && 'pointer-events-none opacity-0'
            )}
          >
            <div className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900">
              <button
                type="button"
                onClick={() => changeScale(-1)}
                aria-label="Decrease text size (−)"
                className={cn(controlClass, 'border-0 px-2')}
              >
                <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </button>
              <span
                className="px-1 text-xs tabular-nums text-slate-300"
                data-testid="wallboard-scale"
              >
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => changeScale(1)}
                aria-label="Increase text size (+)"
                className={cn(controlClass, 'border-0 px-2')}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCycle(value => !value)}
              aria-pressed={cycle}
              data-testid="wallboard-cycle"
              className={controlClass}
            >
              {cycle ? (
                <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {cycle ? 'Auto-cycle on' : 'Auto-cycle off'}
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              data-testid="wallboard-fullscreen"
              className={controlClass}
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen (F)'}
            </button>
            <Link
              href="/"
              data-testid="wallboard-exit"
              onClick={() => {
                if (getFullscreenElement()) void exitFullscreen();
              }}
              className={controlClass}
            >
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Exit
            </Link>
          </div>
        </header>

        {fullscreenHint && !fullscreen && (
          <div
            role="status"
            data-testid="wallboard-fullscreen-hint"
            className="mb-[1.2vh] flex items-center justify-between rounded-xl border border-sky-500/40 bg-sky-950/50 px-4 py-2 text-sm text-sky-100"
          >
            <span>
              This browser does not allow pages to go fullscreen. Use the browser or TV&apos;s own
              fullscreen (F11, ⌃⌘F on macOS) or launch it in kiosk mode — the wallboard already
              fills the whole window.
            </span>
            <button
              type="button"
              onClick={() => setFullscreenHint(false)}
              className="ml-4 rounded px-2 py-1 text-xs font-semibold hover:bg-sky-900/60 focus-visible:ring-4 focus-visible:ring-sky-400/70"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-[1vh] flex items-center justify-between px-1 text-[clamp(11px,0.8vw,22px)] text-slate-400">
          <span
            className="font-semibold uppercase tracking-wider text-slate-300"
            data-testid="wallboard-view"
          >
            {liveViewLabel(query.view)}
            {cycle && hasCritical && (
              <span className="font-normal normal-case text-slate-500"> · rotating views</span>
            )}
          </span>
          {cycle && hasCritical && (
            <span className="h-1 w-40 overflow-hidden rounded-full bg-zinc-800" aria-hidden>
              <span
                className="block h-full rounded-full bg-slate-400 transition-[width] duration-1000"
                style={{ width: `${Math.round(cycleProgress * 100)}%` }}
              />
            </span>
          )}
          <span>
            {formatSyncAge(syncedAt, now)}
            {wakeLockActive ? ' · screen kept awake' : ''}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-[1.2vw] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24vw)]">
          <div className="min-h-0 text-[clamp(15px,1.05vw,30px)]">
            <LiveIncidentsPanel
              variant="wallboard"
              services={[]}
              teams={[]}
              canAcknowledge={false}
              canAssignSelf={false}
              canExport={false}
              currentUserName=""
            />
          </div>
          {/* Rail cards use app sizing; scale them up for across-the-room legibility. */}
          <aside className="hidden min-h-0 overflow-hidden xl:block min-[1800px]:[zoom:1.2] min-[2600px]:[zoom:1.7]">
            <div className="mb-[1.2vw]">
              <OnCallCard />
            </div>
            <SlaRiskCard />
          </aside>
        </div>
      </div>
    </div>
  );
}
