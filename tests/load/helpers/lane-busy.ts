/**
 * Wall time inside the timed burst during which at least one lane handler was running (the union of the
 * handler spans, clipped to the burst). Items that finished before the burst or started after it do not
 * count: this is what "lane busy" means for the gate.
 */
export function laneWorkInBurstMs(
  spans: Array<{ startMs: number; endMs: number | null }> | undefined,
  burstSec: number
): number {
  const burstMs = burstSec * 1000;
  const clipped = (spans ?? [])
    .map(span => [Math.max(0, span.startMs), Math.min(burstMs, span.endMs ?? burstMs)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let coveredTo = 0;
  for (const [start, end] of clipped) {
    if (end <= coveredTo) continue;
    total += end - Math.max(start, coveredTo);
    coveredTo = end;
  }
  return total;
}
