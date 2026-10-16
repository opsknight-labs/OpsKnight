import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_REFRESH_INTERVAL_MS,
  MAX_IDLE_REFRESH_INTERVAL_MS,
  MIN_RESUME_REFRESH_GAP_MS,
  RESUME_DEBOUNCE_MS,
  createRefreshScheduler,
  nextRefreshDelay,
} from '@/components/runbooks/useRunbookRefresh';
import { formatRefreshAge } from '@/components/runbooks/RunbookLiveRefresh';

describe('nextRefreshDelay', () => {
  it('polls every 5s while active', () => {
    expect(nextRefreshDelay({ active: true, baseIntervalMs: 15000, idleStreak: 4 })).toBe(
      ACTIVE_REFRESH_INTERVAL_MS
    );
  });

  it('backs off exponentially up to 60s while idle', () => {
    const delays = [0, 1, 2, 3, 4].map(idleStreak =>
      nextRefreshDelay({ active: false, baseIntervalMs: 15000, idleStreak })
    );
    expect(delays).toEqual([15000, 30000, 60000, 60000, 60000]);
    expect(Math.max(...delays)).toBe(MAX_IDLE_REFRESH_INTERVAL_MS);
  });

  it('keeps the fixed interval for callers that do not report activity', () => {
    expect(nextRefreshDelay({ baseIntervalMs: 20000, idleStreak: 6 })).toBe(20000);
  });
});

describe('createRefreshScheduler', () => {
  let visible = true;
  const refresh = vi.fn();
  const make = (config: Partial<Parameters<typeof createRefreshScheduler>[1]> = {}) =>
    createRefreshScheduler(
      { refresh, isVisible: () => visible },
      { enabled: true, intervalMs: 15000, refreshOnFocus: true, ...config }
    );

  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    refresh.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes every 5s while active', () => {
    const scheduler = make({ active: true });
    scheduler.start();
    vi.advanceTimersByTime(ACTIVE_REFRESH_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('backs off when idle and resets when work becomes active', () => {
    const scheduler = make({ active: false });
    scheduler.start();
    vi.advanceTimersByTime(15000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60000);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(scheduler.getIdleStreak()).toBe(4);

    scheduler.update({ enabled: true, intervalMs: 15000, refreshOnFocus: true, active: true });
    vi.advanceTimersByTime(ACTIVE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(scheduler.getIdleStreak()).toBe(0);
    scheduler.stop();
  });

  it('pauses while hidden and refreshes once on becoming visible', () => {
    const scheduler = make({ active: true });
    scheduler.start();
    visible = false;
    scheduler.handleVisibilityChange();
    vi.advanceTimersByTime(60000);
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    scheduler.handleVisibilityChange();
    scheduler.handleFocus();
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(ACTIVE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('does not thrash on rapid focus and blur', () => {
    const scheduler = make({ active: false });
    scheduler.start();
    vi.advanceTimersByTime(MIN_RESUME_REFRESH_GAP_MS);
    for (let i = 0; i < 10; i += 1) {
      scheduler.handleFocus();
      vi.advanceTimersByTime(RESUME_DEBOUNCE_MS / 2);
    }
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.handleFocus();
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('skips the timer when disabled but still refreshes on focus', () => {
    const scheduler = make({ enabled: false });
    scheduler.start();
    vi.advanceTimersByTime(120000);
    expect(refresh).not.toHaveBeenCalled();
    scheduler.handleFocus();
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('refreshes immediately on demand and reports the refresh time', () => {
    const onRefreshed = vi.fn();
    const scheduler = createRefreshScheduler(
      { refresh, isVisible: () => true, now: () => 1234, onRefreshed },
      { enabled: true, intervalMs: 15000, refreshOnFocus: true, active: false }
    );
    scheduler.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onRefreshed).toHaveBeenCalledWith(1234);
    expect(scheduler.getLastRefreshedAt()).toBe(1234);
    scheduler.stop();
  });

  it('stops all timers', () => {
    const scheduler = make({ active: true });
    scheduler.start();
    scheduler.handleFocus();
    scheduler.stop();
    vi.advanceTimersByTime(120000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('formatRefreshAge', () => {
  it('formats elapsed time compactly', () => {
    expect(formatRefreshAge(1000)).toBe('just now');
    expect(formatRefreshAge(12000)).toBe('12s ago');
    expect(formatRefreshAge(125000)).toBe('2m ago');
  });
});
