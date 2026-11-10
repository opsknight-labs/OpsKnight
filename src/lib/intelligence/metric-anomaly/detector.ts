/**
 * Seasonal-baseline anomaly detection for one metric series. Pure and deterministic: no I/O, no clock.
 *
 * Each sample of the current window is compared with the samples taken at the same time of week in the
 * previous N weeks (and their immediate neighbours, which absorbs small phase jitter). The baseline is the
 * median of those values and its spread the median absolute deviation (MAD), both robust to an outage or a
 * spike in one of the history weeks. A sample deviates when
 *
 *   |value - median| / max(1.4826 * MAD, relativeFloor * |median|, EPSILON) >= threshold
 *
 * and |value - median| >= minDeviation. 1.4826 * MAD estimates a standard deviation for normal data, so a
 * threshold of 5 means "about five standard deviations, measured robustly". The floor stops a perfectly flat
 * history (MAD 0) from turning every rounding difference into an infinite score; `minDeviation` lets an
 * operator ignore changes that are too small to matter (a counter moving from 0 to 1).
 *
 * Consecutive deviating samples in the same direction form one deviation; a run must be `minConsecutive`
 * samples long. Missing samples (gaps) end a run, and a sample with too few baseline values is not judged.
 */

/* eslint-disable security/detect-object-injection -- every index below is a computed number into a local array */

export const MAD_TO_SIGMA = 1.4826;
const EPSILON = 1e-9;
/** Scores are reported up to this value; beyond it the number carries no extra meaning. */
export const MAX_SCORE = 1_000;
export const WEEK_MS = 7 * 86_400_000;

export type DeviationDirection = 'UP' | 'DOWN';
export type DirectionFilter = DeviationDirection | 'BOTH';

/** [epoch milliseconds, value] */
export type SamplePoint = readonly [number, number];

export interface HistoryWeek {
  /** How many weeks back this series was taken (1 = last week). Its points are shifted forward by that much. */
  weeksAgo: number;
  points: readonly SamplePoint[];
}

export interface DetectorOptions {
  thresholdMad: number;
  direction: DirectionFilter;
  /** Sampling interval of the series in milliseconds. */
  stepMs: number;
  /** Baseline values required before a sample is judged at all. */
  minBaselineSamples?: number;
  /** Samples in a row required for a deviation. */
  minConsecutive?: number;
  /** Neighbouring steps on each side, per history week, that join the baseline. */
  neighbourhood?: number;
  /** Fraction of |median| the scale may never fall below (flat histories). */
  relativeFloor?: number;
  /** Absolute |value - median| below which a sample never deviates. */
  minDeviation?: number;
}

export interface Deviation {
  /** First deviating sample. */
  at: number;
  /** Last deviating sample. */
  endAt: number;
  /** Sample with the largest score. */
  peakAt: number;
  direction: DeviationDirection;
  /** Peak score: deviation from the median in robust standard units. */
  score: number;
  value: number;
  baselineMedian: number;
  baselineMad: number;
  baselineSamples: number;
  points: number;
}

export interface SampleJudgement {
  at: number;
  value: number;
  median: number;
  mad: number;
  samples: number;
  /** Signed score; null when the baseline was too thin to judge. */
  score: number | null;
}

export const DETECTOR_DEFAULTS = {
  minBaselineSamples: 3,
  minConsecutive: 2,
  neighbourhood: 1,
  relativeFloor: 0.01,
  minDeviation: 0,
} as const;

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median absolute deviation from the median. */
export function medianAbsoluteDeviation(
  values: readonly number[],
  center = median(values)
): number {
  if (values.length === 0) return Number.NaN;
  return median(values.map(value => Math.abs(value - center)));
}

/** Only finite points, ascending by time, one value per timestamp (the last one wins). */
export function cleanSeries(points: readonly SamplePoint[]): SamplePoint[] {
  const byTime = new Map<number, number>();
  for (const [at, value] of points)
    if (Number.isFinite(at) && Number.isFinite(value)) byTime.set(at, value);
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]);
}

/** Index of the first point at or after `at` (binary search over a sorted series). */
function lowerBound(points: readonly SamplePoint[], at: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle][0] < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The baseline values for one instant: from each history week, every point within
 * `neighbourhood` steps (plus half a step of jitter) of the same time of week.
 */
export function baselineValuesAt(
  at: number,
  history: ReadonlyArray<{ weeksAgo: number; points: readonly SamplePoint[] }>,
  stepMs: number,
  neighbourhood: number
): number[] {
  const radius = neighbourhood * stepMs + stepMs / 2;
  const values: number[] = [];
  for (const week of history) {
    const target = at - week.weeksAgo * WEEK_MS;
    for (
      let index = lowerBound(week.points, target - radius);
      index < week.points.length && week.points[index][0] <= target + radius;
      index += 1
    )
      values.push(week.points[index][1]);
  }
  return values;
}

/** Judges every sample of the current window against its seasonal baseline. */
export function judgeSamples(
  current: readonly SamplePoint[],
  history: readonly HistoryWeek[],
  options: DetectorOptions
): SampleJudgement[] {
  const minSamples = options.minBaselineSamples ?? DETECTOR_DEFAULTS.minBaselineSamples;
  const neighbourhood = options.neighbourhood ?? DETECTOR_DEFAULTS.neighbourhood;
  const relativeFloor = options.relativeFloor ?? DETECTOR_DEFAULTS.relativeFloor;
  const minDeviation = options.minDeviation ?? DETECTOR_DEFAULTS.minDeviation;
  const weeks = history.map(week => ({
    weeksAgo: week.weeksAgo,
    points: cleanSeries(week.points),
  }));
  return cleanSeries(current).map(([at, value]) => {
    const baseline = baselineValuesAt(at, weeks, options.stepMs, neighbourhood);
    if (baseline.length < minSamples)
      return {
        at,
        value,
        median: Number.NaN,
        mad: Number.NaN,
        samples: baseline.length,
        score: null,
      };
    const center = median(baseline);
    const mad = medianAbsoluteDeviation(baseline, center);
    const scale = Math.max(MAD_TO_SIGMA * mad, relativeFloor * Math.abs(center), EPSILON);
    const difference = value - center;
    const score =
      Math.abs(difference) < minDeviation
        ? 0
        : Math.max(-MAX_SCORE, Math.min(MAX_SCORE, difference / scale));
    return { at, value, median: center, mad, samples: baseline.length, score };
  });
}

/**
 * Deviations of the current window from its seasonal baseline, oldest first. A run ends at a sample that
 * does not deviate, deviates the other way, cannot be judged, or follows a gap of more than 1.5 steps.
 */
export function detectDeviations(
  current: readonly SamplePoint[],
  history: readonly HistoryWeek[],
  options: DetectorOptions
): Deviation[] {
  const minConsecutive = Math.max(1, options.minConsecutive ?? DETECTOR_DEFAULTS.minConsecutive);
  const threshold = Math.max(EPSILON, options.thresholdMad);
  const judged = judgeSamples(current, history, options);
  const deviations: Deviation[] = [];
  let run: SampleJudgement[] = [];
  let runDirection: DeviationDirection | null = null;

  const close = () => {
    if (runDirection && run.length >= minConsecutive) {
      const peak = run.reduce((best, sample) =>
        Math.abs(sample.score ?? 0) > Math.abs(best.score ?? 0) ? sample : best
      );
      deviations.push({
        at: run[0].at,
        endAt: run[run.length - 1].at,
        peakAt: peak.at,
        direction: runDirection,
        score: Math.abs(peak.score ?? 0),
        value: peak.value,
        baselineMedian: peak.median,
        baselineMad: peak.mad,
        baselineSamples: peak.samples,
        points: run.length,
      });
    }
    run = [];
    runDirection = null;
  };

  for (const sample of judged) {
    const previous = run[run.length - 1];
    if (previous && sample.at - previous.at > options.stepMs * 1.5) close();
    const score = sample.score;
    const direction: DeviationDirection | null =
      score === null || Math.abs(score) < threshold ? null : score > 0 ? 'UP' : 'DOWN';
    const wanted =
      direction !== null && (options.direction === 'BOTH' || options.direction === direction);
    if (!wanted) {
      close();
      continue;
    }
    if (runDirection !== null && runDirection !== direction) close();
    runDirection = direction;
    run.push(sample);
  }
  close();
  return deviations;
}
