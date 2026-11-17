'use client';

import { memo, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

export type RelativeTimeFormat = 'long' | 'short' | 'narrow';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toMs(value: Date | string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Pure label formatter used by `<RelativeTime>`.
 * - `short`: "just now", "5m ago", "in 2h", then "Nov 3" after a week
 * - `long`: "5 minutes ago", "in 2 hours", then the full date/time after a week
 * - `narrow`: "Now", "5m", "3h", "2d" (ages for dense live rows; future clamps to "Now")
 */
export function formatRelativeLabel(
  value: Date | string | number,
  now: number,
  format: RelativeTimeFormat = 'short',
  timeZone = 'UTC'
): string {
  const ms = toMs(value);
  if (Number.isNaN(ms)) return '';
  const diff = ms - now;
  const future = diff > 0;
  const abs = Math.abs(diff);

  if (format === 'narrow') {
    const age = Math.max(0, -diff);
    if (age < MINUTE) return 'Now';
    if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
    if (age < DAY) return `${Math.floor(age / HOUR)}h`;
    return `${Math.floor(age / DAY)}d`;
  }

  if (abs < MINUTE) return future ? 'in a few seconds' : 'just now';

  const [value_, shortUnit, longUnit] =
    abs < HOUR
      ? [Math.floor(abs / MINUTE), 'm', 'minute']
      : abs < DAY
        ? [Math.floor(abs / HOUR), 'h', 'hour']
        : [Math.floor(abs / DAY), 'd', 'day'];

  if (abs < 7 * DAY) {
    const amount = format === 'long' ? plural(value_, longUnit) : `${value_}${shortUnit}`;
    return future ? `in ${amount}` : `${amount} ago`;
  }

  if (format === 'long') return formatDateTime(new Date(ms), timeZone, { format: 'datetime' });

  const date = formatDateTime(new Date(ms), timeZone, { format: 'date' });
  const today = formatDateTime(new Date(now), timeZone, { format: 'date' });
  const sameYear = date.slice(-4) === today.slice(-4);
  // "Nov 3, 2026" → "Nov 3" within the current year.
  return sameYear ? date.replace(/,\s*\d{4}$/, '') : date;
}

/** Re-render cadence: fast while the label changes every minute, slow once it reads in hours/days. */
export function relativeTimeCadence(ms: number, now: number): number {
  const abs = Math.abs(ms - now);
  if (abs < HOUR) return 30_000;
  if (abs < DAY) return 5 * MINUTE;
  return HOUR;
}

type Ticker = { timer: ReturnType<typeof setInterval>; listeners: Set<() => void> };
const tickers = new Map<number, Ticker>();

/** One shared interval per cadence, so a list of 100 timestamps runs at most three timers. */
function subscribeTicker(intervalMs: number, listener: () => void): () => void {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    const listeners = new Set<() => void>();
    const timer = setInterval(() => listeners.forEach(fn => fn()), intervalMs);
    ticker = { timer, listeners };
    tickers.set(intervalMs, ticker);
  }
  ticker.listeners.add(listener);
  return () => {
    const current = tickers.get(intervalMs);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      clearInterval(current.timer);
      tickers.delete(intervalMs);
    }
  };
}

export type RelativeTimeProps = {
  date: Date | string | number | null | undefined;
  format?: RelativeTimeFormat;
  /**
   * External clock (ms). When given, the component renders against it and starts no
   * timer of its own; use it in lists that already tick (e.g. the live dashboard).
   */
  now?: number;
  /** Defaults to the signed-in user's timezone from `TimezoneContext`. */
  timeZone?: string;
  /** Rendered when `date` is missing or invalid. */
  fallback?: string;
  className?: string;
};

/**
 * Relative timestamp ("5m ago") inside `<time dateTime>`, with the absolute time and
 * timezone on hover. Updates itself on a shared interval; only this element re-renders.
 */
function RelativeTime({
  date,
  format = 'short',
  now: externalNow,
  timeZone,
  fallback = '—',
  className,
}: RelativeTimeProps) {
  const { userTimeZone } = useTimezone();
  const tz = timeZone ?? userTimeZone;
  const ms = toMs(date);
  const [internalNow, setInternalNow] = useState(() => Date.now());
  const now = externalNow ?? internalNow;
  const cadence = Number.isNaN(ms) ? 0 : relativeTimeCadence(ms, now);

  useEffect(() => {
    if (externalNow !== undefined || cadence === 0) return;
    return subscribeTicker(cadence, () => setInternalNow(Date.now()));
  }, [externalNow, cadence]);

  if (Number.isNaN(ms)) {
    return <span className={cn('tabular-nums', className)}>{fallback}</span>;
  }

  const instant = new Date(ms);
  const absolute = formatDateTime(instant, tz, { format: 'datetime', includeTimeZone: true });

  return (
    <time
      dateTime={instant.toISOString()}
      title={absolute}
      className={cn('tabular-nums', className)}
      suppressHydrationWarning
    >
      {formatRelativeLabel(ms, now, format, tz)}
    </time>
  );
}

export default memo(RelativeTime);
