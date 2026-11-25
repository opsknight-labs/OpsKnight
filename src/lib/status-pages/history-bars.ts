import type { PublicStatusHistoryDay } from '@/lib/status-pages/public-contract';

export const WIDE_BAR_COUNT = 90;
export const NARROW_BAR_COUNT = 30;

/** Most recent `count` days, keeping their original indexes so selection state stays stable. */
export function visibleBarIndexes(total: number, count: number): number[] {
  const start = Math.max(0, total - count);
  return Array.from({ length: total - start }, (_, i) => start + i);
}

export type BarSeverity = 'ok' | 'minor' | 'moderate' | 'severe' | 'none';

/** Grades a day by availability so a 99.2% "operational" day does not look identical to 100%. */
export function barSeverity(day: Pick<PublicStatusHistoryDay, 'status' | 'availabilityPercent'>): BarSeverity {
  if (day.status === 'UNKNOWN' || day.status === 'MAINTENANCE') return 'none';
  const pct = day.availabilityPercent;
  if (pct == null) return day.status === 'OPERATIONAL' ? 'ok' : 'moderate';
  if (pct >= 99.99) return 'ok';
  if (pct >= 99.5) return 'minor';
  if (pct >= 98) return 'moderate';
  return 'severe';
}

/** Whole minutes of downtime implied by availability, for tooltips. */
export function downtimeMinutes(availabilityPercent: number | null): number | null {
  if (availabilityPercent == null) return null;
  return Math.round(((100 - availabilityPercent) / 100) * 1440);
}

export function barTooltip(
  day: PublicStatusHistoryDay,
  statusLabel: string
): string {
  const down = downtimeMinutes(day.availabilityPercent);
  const parts = [day.date, statusLabel];
  if (day.availabilityPercent != null) parts.push(`${day.availabilityPercent}%`);
  if (down != null && down > 0) parts.push(`${down} min downtime`);
  return parts.join(' · ');
}
