import type { ImpactTimelineEntry, TimeWindow } from '@/lib/business-services/contract';

const DAY = 86_400_000;

/** Minutes of (non-excluded) impact per day, oldest first; overlaps in a day count once. */
export function dailyImpactMinutes(
  entries: readonly ImpactTimelineEntry[],
  window: TimeWindow,
  now: Date = window.to
): number[] {
  const days = Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / DAY));
  const start = window.to.getTime() - days * DAY;
  return Array.from({ length: days }, (_, day) => {
    const from = start + day * DAY;
    const to = from + DAY;
    const clipped = entries
      .filter(entry => !entry.excluded)
      .map(entry => [
        Math.max(entry.startedAt.getTime(), from),
        Math.min((entry.endedAt ?? now).getTime(), to),
      ])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let end = from;
    for (const [a, b] of clipped) {
      if (b <= end) continue;
      total += b - Math.max(a, end);
      end = b;
    }
    return total / 60_000;
  });
}
