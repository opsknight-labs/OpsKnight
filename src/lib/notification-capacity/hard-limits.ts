// Absolute safety guardrails. Not configurable — changing requires a code change.
export const HARD_LIMITS = {
  ratePerSecond: { min: 1, max: 10_000 },
  maxInFlight: { min: 1, max: 5_000 },
  bulkSharePercent: { min: 5, max: 95 },
  queueLowWatermark: { min: 100, max: 1_000_000 },
  queueHighWatermark: { min: 1_000, max: 1_000_000 },
  quotaBlockSize: { min: 1, max: 1_000 },
} as const;

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value)) return min;
  return Math.min(max, Math.max(min, value));
}
