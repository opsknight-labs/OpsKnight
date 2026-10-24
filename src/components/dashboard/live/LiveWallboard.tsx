'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Maximize2, Minimize2, Pause, Play, WifiOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveClock from '@/components/dashboard/LiveClock';
import { LIVE_VIEW_LABELS } from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';
import LiveIncidentsPanel, { formatSyncAge } from './LiveIncidentsPanel';
import { OnCallCard, SlaRiskCard } from './ResponderRail';
import { buildInsight } from './LiveCommandStrip';

const CYCLE_MS = 20_000;
const IDLE_HIDE_MS = 5_000;
const BURN_IN_SHIFT_MS = 3 * 60_000;
/** Kiosk safety net: a periodic full reload clears long-running browser memory growth. */
const KIOSK_RELOAD_MS = 12 * 60 * 60_000;

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

/** Hides controls and the cursor after a few idle seconds, as a TV should. */
function useIdle(timeoutMs: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), timeoutMs);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), timeoutMs);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart'] as const;
    for (const event of events) window.addEventListener(event, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [timeoutMs]);
  return idle;
}

export default function LiveWallboard({ timeZone }: { timeZone: string }) {
  const { snapshot, query, setQuery, health, syncedAt, now } = useLiveDashboard();
  const [cycle, setCycle] = useState(true);
  const [cycleStartedAt, setCycleStartedAt] = useState(0);
  useEffect(() => {
    // `?cycle=off` pins a TV to one view (e.g. a team board using ?lteam=...).
    if (new URLSearchParams(window.location.search).get('cycle') === 'off') setCycle(false);
    setCycleStartedAt(Date.now());
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
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

  // Alternate Critical and All Active only while critical incidents exist; facets (e.g. a
  // team-specific TV via ?lteam=...) are preserved.
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
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
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

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  const offsets = [
    [0, 0],
    [2, 1],
    [1, 2],
    [-1, 1],
  ][shift];
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
      data-testid="wallboard"
      data-wake-lock={wakeLockActive ? 'on' : 'off'}
      className={cn(
        'dark fixed inset-0 z-[60] overflow-hidden bg-[#050507] text-foreground',
        idle && 'cursor-none'
      )}
      style={{ colorScheme: 'dark' }}
    >
      <div
        className="flex h-full flex-col gap-[1.2vh] p-[1.5vw] transition-transform duration-[2000ms]"
        style={{ transform: `translate(${offsets[0]}px, ${offsets[1]}px)` }}
      >
        {degraded && (
          <div
            role="alert"
            data-testid="wallboard-degraded"
            className="flex items-center gap-3 rounded-xl border border-rose-500/60 bg-rose-950/70 px-5 py-3 text-[clamp(14px,1.1vw,28px)] font-semibold text-rose-100"
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

        <header className="flex flex-wrap items-center justify-between gap-[1.5vw] rounded-2xl border border-zinc-800 bg-gradient-to-b from-[#121216] to-[#09090b] px-[1.5vw] py-[1.2vh] text-slate-100">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-4">
              <h1 className="text-[clamp(20px,1.9vw,56px)] font-extrabold tracking-tight text-white">
                Incident Wallboard
              </h1>
              <LiveClock timeZone={timeZone} />
            </div>
            <p
              className={cn(
                'text-[clamp(13px,1vw,28px)] font-medium',
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
          <dl className="flex flex-wrap gap-[2.2vw]">
            {counters.map(counter => (
              <div key={counter.label} className="text-center">
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
            className={cn(
              'flex items-center gap-2 transition-opacity duration-500',
              idle && 'pointer-events-none opacity-0'
            )}
          >
            <button
              type="button"
              onClick={() => setCycle(value => !value)}
              aria-pressed={cycle}
              data-testid="wallboard-cycle"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-zinc-800"
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
              onClick={toggleFullscreen}
              data-testid="wallboard-fullscreen"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-zinc-800"
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
            <Link
              href="/"
              data-testid="wallboard-exit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-zinc-800"
            >
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Exit
            </Link>
          </div>
        </header>

        <div className="flex items-center justify-between gap-3 px-1 text-[clamp(11px,0.8vw,22px)] text-slate-400">
          <span
            className="font-semibold uppercase tracking-wider text-slate-300"
            data-testid="wallboard-view"
          >
            {LIVE_VIEW_LABELS[query.view]}
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
          {/* Rail cards use fixed app sizing; scale them up for across-the-room legibility. */}
          <aside className="hidden min-h-0 space-y-[1.2vw] overflow-hidden xl:block min-[1800px]:[zoom:1.2] min-[2600px]:[zoom:1.7]">
            <OnCallCard />
            <SlaRiskCard />
          </aside>
        </div>
      </div>
    </div>
  );
}
