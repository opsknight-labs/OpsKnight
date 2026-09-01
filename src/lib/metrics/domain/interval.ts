export type TimeInterval = { start: Date; end: Date };

export function intersectInterval(
  interval: TimeInterval,
  window: TimeInterval
): TimeInterval | null {
  const start = new Date(Math.max(interval.start.getTime(), window.start.getTime()));
  const end = new Date(Math.min(interval.end.getTime(), window.end.getTime()));
  return start < end ? { start, end } : null;
}

/** Canonical interval union. All product time ranges are half-open: [start, end). */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .filter(interval => interval.start < interval.end)
    .map(interval => ({ start: new Date(interval.start), end: new Date(interval.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  const merged: TimeInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start.getTime() > previous.end.getTime()) {
      merged.push(interval);
    } else if (interval.end > previous.end) {
      previous.end = interval.end;
    }
  }
  return merged;
}

export function intervalDurationMs(intervals: TimeInterval[]): number {
  return mergeIntervals(intervals).reduce(
    (total, interval) => total + interval.end.getTime() - interval.start.getTime(),
    0
  );
}

export function intervalGaps(window: TimeInterval, intervals: TimeInterval[]): TimeInterval[] {
  const covered = mergeIntervals(
    intervals
      .map(interval => intersectInterval(interval, window))
      .filter((interval): interval is TimeInterval => interval !== null)
  );
  const gaps: TimeInterval[] = [];
  let cursor = window.start;
  for (const interval of covered) {
    if (cursor < interval.start) gaps.push({ start: cursor, end: interval.start });
    if (interval.end > cursor) cursor = interval.end;
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps;
}
