/**
 * Time windows for the AIOps overview. Pure and dependency-free so the page, its components and the
 * data module agree on the same bounds; every query in the overview is limited to one of these.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type OverviewWindowKey = '24h' | '7d' | '30d';

export interface OverviewWindowSpec {
  key: OverviewWindowKey;
  label: string;
  short: string;
  ms: number;
  bucketMs: number;
}

export const OVERVIEW_WINDOW_LIST: readonly OverviewWindowSpec[] = [
  { key: '24h', label: 'Last 24 hours', short: '24h', ms: DAY_MS, bucketMs: HOUR_MS },
  { key: '7d', label: 'Last 7 days', short: '7d', ms: 7 * DAY_MS, bucketMs: DAY_MS },
  { key: '30d', label: 'Last 30 days', short: '30d', ms: 30 * DAY_MS, bucketMs: DAY_MS },
];

export const DEFAULT_OVERVIEW_WINDOW: OverviewWindowKey = '7d';

export function overviewWindowSpec(key: OverviewWindowKey): OverviewWindowSpec {
  return (
    OVERVIEW_WINDOW_LIST.find(spec => spec.key === key) ??
    (OVERVIEW_WINDOW_LIST.find(spec => spec.key === DEFAULT_OVERVIEW_WINDOW) as OverviewWindowSpec)
  );
}

export interface OverviewWindow {
  key: OverviewWindowKey;
  label: string;
  /** Start of the selected window (inclusive). */
  since: Date;
  /** End of the selected window (exclusive): the moment the page was rendered. */
  until: Date;
  /** Start of the equally long window immediately before the selected one. */
  previousSince: Date;
  /** Whole days covered, at least one; used by modules that count in days. */
  days: number;
  bucketMs: number;
  buckets: number;
}

export function parseOverviewWindow(value: unknown): OverviewWindowKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return OVERVIEW_WINDOW_LIST.find(spec => spec.key === raw)?.key ?? DEFAULT_OVERVIEW_WINDOW;
}

export function resolveOverviewWindow(
  key: OverviewWindowKey,
  now: Date = new Date()
): OverviewWindow {
  const spec = overviewWindowSpec(key);
  const until = new Date(now.getTime());
  const since = new Date(until.getTime() - spec.ms);
  return {
    key: spec.key,
    label: spec.label,
    since,
    until,
    previousSince: new Date(since.getTime() - spec.ms),
    days: Math.max(1, Math.round(spec.ms / DAY_MS)),
    bucketMs: spec.bucketMs,
    buckets: Math.round(spec.ms / spec.bucketMs),
  };
}

/** Compact duration for tiles and tables: 45 s, 12 min, 3.4 h, 2.1 d. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, seconds);
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86_400).toFixed(1)} d`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 1000) / 10}%`;
}

/** 1,284 / 12.9K / 4.2M: auto-compact for stat tiles. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 10_000) return Math.round(value).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  );
}
