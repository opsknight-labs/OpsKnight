'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useRouter } from 'next/navigation';

export type RunbookRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
  refreshOnFocus?: boolean;
  /** When set, polls every 5s while true and backs off exponentially (max 60s) while false. */
  active?: boolean;
};

export const ACTIVE_REFRESH_INTERVAL_MS = 5_000;
export const MAX_IDLE_REFRESH_INTERVAL_MS = 60_000;
export const RESUME_DEBOUNCE_MS = 400;
export const MIN_RESUME_REFRESH_GAP_MS = 2_000;

export function nextRefreshDelay({
  active,
  baseIntervalMs,
  idleStreak,
}: {
  active?: boolean;
  baseIntervalMs: number;
  idleStreak: number;
}): number {
  if (active) return ACTIVE_REFRESH_INTERVAL_MS;
  if (active === undefined) return baseIntervalMs;
  return Math.min(MAX_IDLE_REFRESH_INTERVAL_MS, baseIntervalMs * 2 ** Math.max(0, idleStreak));
}

export type RefreshSchedulerConfig = {
  enabled: boolean;
  intervalMs: number;
  refreshOnFocus: boolean;
  active?: boolean;
};

export function createRefreshScheduler(
  deps: {
    refresh: () => void;
    isVisible: () => boolean;
    now?: () => number;
    onRefreshed?: (at: number) => void;
  },
  initial: RefreshSchedulerConfig
) {
  const now = deps.now ?? Date.now;
  let config = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let idleStreak = 0;
  let lastRefreshedAt = now();
  let stopped = false;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const clearResume = () => {
    if (resumeTimer !== undefined) clearTimeout(resumeTimer);
    resumeTimer = undefined;
  };
  const runRefresh = () => {
    lastRefreshedAt = now();
    deps.refresh();
    deps.onRefreshed?.(lastRefreshedAt);
  };
  const schedule = () => {
    clearTimer();
    if (stopped || !config.enabled || config.intervalMs <= 0 || !deps.isVisible()) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        if (!deps.isVisible()) return;
        runRefresh();
        if (config.active === false) idleStreak += 1;
        schedule();
      },
      nextRefreshDelay({ active: config.active, baseIntervalMs: config.intervalMs, idleStreak })
    );
  };
  // Coalesces visibilitychange + focus bursts into a single refresh.
  const resume = () => {
    clearResume();
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined;
      if (stopped || !deps.isVisible()) return;
      if (now() - lastRefreshedAt >= MIN_RESUME_REFRESH_GAP_MS) {
        idleStreak = 0;
        runRefresh();
      }
      schedule();
    }, RESUME_DEBOUNCE_MS);
  };

  return {
    start: schedule,
    update(next: RefreshSchedulerConfig) {
      if (next.active && !config.active) idleStreak = 0;
      config = next;
      schedule();
    },
    handleVisibilityChange() {
      if (!deps.isVisible()) {
        clearTimer();
        clearResume();
        return;
      }
      if (config.enabled || config.refreshOnFocus) resume();
    },
    handleFocus() {
      if (config.refreshOnFocus) resume();
    },
    refreshNow() {
      idleStreak = 0;
      runRefresh();
      schedule();
    },
    stop() {
      stopped = true;
      clearTimer();
      clearResume();
    },
    getLastRefreshedAt: () => lastRefreshedAt,
    getIdleStreak: () => idleStreak,
  };
}

export function useRunbookRefresh(
  router: ReturnType<typeof useRouter>,
  options: boolean | RunbookRefreshOptions = true
) {
  const config = typeof options === 'boolean' ? { enabled: options } : options;
  const { enabled = true, intervalMs = 15000, refreshOnFocus = true, active } = config;
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createRefreshScheduler> | null>(null);

  useEffect(() => {
    // Real configuration is applied by the effect below, which runs in the same commit.
    const scheduler = createRefreshScheduler(
      {
        refresh: () => router.refresh(),
        isVisible: () => document.visibilityState === 'visible',
        onRefreshed: setLastRefreshedAt,
      },
      { enabled: false, intervalMs: 0, refreshOnFocus: false }
    );
    schedulerRef.current = scheduler;
    const onVisibility = () => scheduler.handleVisibilityChange();
    const onFocus = () => scheduler.handleFocus();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      scheduler.stop();
      schedulerRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [router]);

  useEffect(() => {
    schedulerRef.current?.update({ enabled, intervalMs, refreshOnFocus, active });
  }, [enabled, intervalMs, refreshOnFocus, active, router]);

  const refreshNow = useCallback(() => schedulerRef.current?.refreshNow(), []);
  return { lastRefreshedAt, refreshNow };
}
