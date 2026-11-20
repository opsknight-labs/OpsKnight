import type { MetricUnit } from '@/lib/analytics/definitions';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 45s, 12m, 3h 20m, 2d 4h. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < MIN) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.round((ms % HOUR) / MIN);
    return m === 60 ? `${h + 1}h` : m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.round((ms % DAY) / HOUR);
  return h === 24 ? `${d + 1}d` : h ? `${d}d ${h}h` : `${d}d`;
}

const countFormat = new Intl.NumberFormat('en-US');

export function formatMetric(value: number | null | undefined, unit: MetricUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  switch (unit) {
    case 'duration':
      return formatDuration(value);
    case 'percent':
      return `${value >= 99.95 || value === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
    case 'ratio':
      return value.toFixed(1);
    case 'hours':
      return `${countFormat.format(Math.round(value))}h`;
    default:
      return countFormat.format(value);
  }
}

export type DeltaTone = 'good' | 'bad' | 'neutral';

/**
 * Change vs the previous period. Percent metrics compare in points
 * (92% → 95% is +3 pts); everything else in relative percent.
 */
export function describeDelta(
  current: number | null,
  previous: number | null,
  unit: MetricUnit,
  better: 'up' | 'down' | 'neutral'
): { label: string; tone: DeltaTone; direction: 'up' | 'down' | 'flat' } | null {
  if (current === null || previous === null) return null;
  const isPoints = unit === 'percent';
  if (!isPoints && previous === 0) return null;
  const change = isPoints ? current - previous : ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { label: 'No change', tone: 'neutral', direction: 'flat' };
  const direction = change > 0 ? 'up' : 'down';
  const tone: DeltaTone = better === 'neutral' ? 'neutral' : direction === better ? 'good' : 'bad';
  const magnitude = Math.abs(change);
  const amount = magnitude >= 10 ? magnitude.toFixed(0) : magnitude.toFixed(1);
  return {
    label: `${direction === 'up' ? '+' : '−'}${amount}${isPoints ? ' pts' : '%'}`,
    tone,
    direction,
  };
}

/** Chart axis label for a bucket key like 2026-11-20T00:00:00. */
export function formatBucket(bucket: string, unit: 'hour' | 'day' | 'week' | 'month'): string {
  const [date, time = '00:00'] = bucket.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const monthName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  if (unit === 'hour') return time.slice(0, 5);
  if (unit === 'month') return `${monthName} ${year}`;
  return `${monthName} ${day}`;
}
