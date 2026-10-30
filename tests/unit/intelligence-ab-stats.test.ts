// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MIN_NOISE_FLOOR,
  bootstrapMedianInterval,
  coefficientOfVariation,
  comparePaired,
  judgeHigherIsWorse,
  judgeLowerIsWorse,
  median,
  percentile,
  seededRandom,
} from '../load/helpers/ab-stats';

describe('percentiles', () => {
  it('uses nearest-rank and handles edges', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile(values, 0.1)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.99)).toBe(7);
    expect(median([3, 1, 2])).toBe(2);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('noise estimate', () => {
  it('is zero for identical runs and grows with spread', () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
    expect(coefficientOfVariation([100])).toBe(0);
    expect(coefficientOfVariation([100, 120, 80, 110, 90])).toBeGreaterThan(0.1);
  });
});

describe('bootstrap', () => {
  it('is reproducible for a given seed and brackets the estimate', () => {
    const values = [1.0, 1.02, 0.98, 1.05, 0.97, 1.01, 1.03];
    const a = bootstrapMedianInterval(values, { seed: 42 });
    const b = bootstrapMedianInterval(values, { seed: 42 });
    expect(a).toEqual(b);
    expect(a.lower).toBeLessThanOrEqual(a.estimate);
    expect(a.upper).toBeGreaterThanOrEqual(a.estimate);
  });

  it('collapses to a point for constant data and tolerates empty input', () => {
    expect(bootstrapMedianInterval([2, 2, 2, 2])).toEqual({ estimate: 2, lower: 2, upper: 2 });
    expect(bootstrapMedianInterval([])).toEqual({ estimate: 0, lower: 0, upper: 0 });
  });

  it('has a deterministic PRNG in [0, 1)', () => {
    const random = seededRandom(7);
    const samples = Array.from({ length: 1000 }, random);
    expect(samples.every(v => v >= 0 && v < 1)).toBe(true);
    expect(seededRandom(7)()).toBe(samples[0]);
  });
});

describe('verdicts', () => {
  const noisyBaseline = [100, 103, 97, 101, 99, 102, 98, 100];

  it('does not call a difference inside the noise a regression', () => {
    const candidate = noisyBaseline.map(v => v * 1.01);
    const comparison = comparePaired(noisyBaseline, candidate);
    expect(judgeHigherIsWorse(comparison)).toBe('NO_DETECTABLE_DIFFERENCE');
  });

  it('flags a consistent, clearly larger latency as a regression', () => {
    const candidate = noisyBaseline.map(v => v * 1.4);
    const comparison = comparePaired(noisyBaseline, candidate);
    expect(judgeHigherIsWorse(comparison)).toBe('REGRESSION');
    expect(judgeLowerIsWorse(comparison)).toBe('IMPROVEMENT');
  });

  it('flags a consistent throughput drop as a regression', () => {
    const throughput = noisyBaseline.map(v => v * 10);
    const comparison = comparePaired(throughput, throughput.map(v => v * 0.6));
    expect(judgeLowerIsWorse(comparison)).toBe('REGRESSION');
  });

  it('demands a wider margin when the baseline itself is noisy', () => {
    const veryNoisy = [100, 160, 70, 140, 90, 150, 80, 130];
    const comparison = comparePaired(veryNoisy, veryNoisy.map(v => v * 1.15));
    expect(comparison.noiseFloor).toBeGreaterThan(0.3);
    expect(judgeHigherIsWorse(comparison)).toBe('NO_DETECTABLE_DIFFERENCE');
  });

  it('refuses to judge from too few repetitions', () => {
    const comparison = comparePaired([100, 100, 100], [150, 150, 150]);
    expect(judgeHigherIsWorse(comparison)).toBe('INSUFFICIENT_DATA');
    expect(comparison.noiseFloor).toBe(MIN_NOISE_FLOOR);
  });

  it('pairs by repetition so slow drift across the run cancels out', () => {
    // Machine slows steadily; the candidate is genuinely identical within each pair.
    const baseline = [100, 110, 120, 130, 140, 150, 160, 170];
    const candidate = baseline.map(v => v * 1.0);
    const comparison = comparePaired(baseline, candidate);
    expect(comparison.interval).toMatchObject({ estimate: 1, lower: 1, upper: 1 });
    expect(judgeHigherIsWorse(comparison)).toBe('NO_DETECTABLE_DIFFERENCE');
  });
});
