/**
 * Statistics for controlled A/B benchmarks. Pure and deterministic (seeded PRNG) so the maths is
 * unit-tested; the benchmark scripts only collect samples.
 */

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank on the sorted samples; stable for the small repetition counts used here.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export const median = (values: readonly number[]) => percentile(values, 0.5);

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Coefficient of variation: run-to-run noise relative to the typical value. */
export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  if (avg === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / Math.abs(avg);
}

/** mulberry32: small, fast, seedable PRNG so bootstrap results are reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapInterval {
  estimate: number;
  lower: number;
  upper: number;
}

/** Percentile bootstrap confidence interval for the median of `values`. */
export function bootstrapMedianInterval(
  values: readonly number[],
  options: { resamples?: number; confidence?: number; seed?: number } = {}
): BootstrapInterval {
  const resamples = options.resamples ?? 5000;
  const confidence = options.confidence ?? 0.95;
  if (values.length === 0) return { estimate: 0, lower: 0, upper: 0 };
  const random = seededRandom(options.seed ?? 1);
  const medians: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]);
    medians.push(median(sample));
  }
  const tail = (1 - confidence) / 2;
  return {
    estimate: median(values),
    lower: percentile(medians, tail),
    upper: percentile(medians, 1 - tail),
  };
}

export interface PairedComparison {
  /** candidate / baseline for each repetition (paired by repetition to cancel drift). */
  ratios: number[];
  interval: BootstrapInterval;
  baselineCv: number;
  /** Differences smaller than this are indistinguishable from baseline run-to-run noise. */
  noiseFloor: number;
}

export const MIN_NOISE_FLOOR = 0.05;

export function comparePaired(
  baseline: readonly number[],
  candidate: readonly number[],
  options: { seed?: number } = {}
): PairedComparison {
  const pairs = Math.min(baseline.length, candidate.length);
  const ratios: number[] = [];
  for (let i = 0; i < pairs; i += 1) {
    if (baseline[i] > 0) ratios.push(candidate[i] / baseline[i]);
  }
  const baselineCv = coefficientOfVariation(baseline);
  return {
    ratios,
    interval: bootstrapMedianInterval(ratios, { seed: options.seed }),
    baselineCv,
    noiseFloor: Math.max(MIN_NOISE_FLOOR, 2 * baselineCv),
  };
}

export type Verdict = 'REGRESSION' | 'IMPROVEMENT' | 'NO_DETECTABLE_DIFFERENCE' | 'INSUFFICIENT_DATA';

/**
 * Judges a ratio where larger is worse (latency). A regression needs the whole confidence interval to
 * sit above 1 + noise floor; anything inside the noise is reported as not detectable, never as "equal".
 * With too few repetitions no verdict is given.
 */
export function judgeHigherIsWorse(comparison: PairedComparison, minimumPairs = 5): Verdict {
  if (comparison.ratios.length < minimumPairs) return 'INSUFFICIENT_DATA';
  const { lower, upper } = comparison.interval;
  if (lower > 1 + comparison.noiseFloor) return 'REGRESSION';
  if (upper < 1 - comparison.noiseFloor) return 'IMPROVEMENT';
  return 'NO_DETECTABLE_DIFFERENCE';
}

/** Throughput is the opposite: a drop is the regression. */
export function judgeLowerIsWorse(comparison: PairedComparison, minimumPairs = 5): Verdict {
  if (comparison.ratios.length < minimumPairs) return 'INSUFFICIENT_DATA';
  const { lower, upper } = comparison.interval;
  if (upper < 1 - comparison.noiseFloor) return 'REGRESSION';
  if (lower > 1 + comparison.noiseFloor) return 'IMPROVEMENT';
  return 'NO_DETECTABLE_DIFFERENCE';
}
