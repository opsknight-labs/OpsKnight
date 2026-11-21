import { describe, expect, it } from 'vitest';
import { ANOMALY_MIN_INCIDENTS, detectRateAnomaly } from '@/lib/intelligence/insights/anomaly';
import { bucketVerdicts, MIN_FEEDBACK_FOR_SUGGESTION, suggestMinScore, type ScoredVerdict } from '@/lib/intelligence/insights/calibration';

const make = (score: number, helpful: number, notHelpful: number): ScoredVerdict[] => [
  ...Array.from({ length: helpful }, () => ({ score, helpful: true })),
  ...Array.from({ length: notHelpful }, () => ({ score, helpful: false })),
];

describe('bucketVerdicts', () => {
  it('groups by score, clamps the top edge and ignores non-finite scores', () => {
    const buckets = bucketVerdicts([
      ...make(0.42, 2, 1),
      ...make(0.95, 1, 0),
      ...make(1, 1, 0),
      { score: Number.NaN, helpful: true },
    ]);
    expect(buckets).toEqual([
      { from: 0.4, to: 0.5, helpful: 2, notHelpful: 1 },
      { from: 0.9, to: 1, helpful: 2, notHelpful: 0 },
    ]);
  });

  it('puts boundary scores in the bucket they start, despite floating-point division', () => {
    const buckets = bucketVerdicts([0.3, 0.6, 0.7].map(score => ({ score, helpful: true })));
    expect(buckets.map(bucket => bucket.from)).toEqual([0.3, 0.6, 0.7]);
  });

  it('returns nothing for no verdicts', () => {
    expect(bucketVerdicts([])).toEqual([]);
  });
});

describe('suggestMinScore', () => {
  it('proposes nothing without enough feedback', () => {
    expect(suggestMinScore(make(0.4, 0, MIN_FEEDBACK_FOR_SUGGESTION - 1), 0.35)).toBeNull();
  });

  it('proposes nothing when the current threshold already performs well', () => {
    expect(suggestMinScore([...make(0.5, 20, 2), ...make(0.8, 10, 0)], 0.35)).toBeNull();
  });

  it('proposes the lowest threshold at which suggestions are reliably helpful', () => {
    const verdicts = [...make(0.4, 1, 14), ...make(0.6, 3, 8), ...make(0.8, 22, 2)];
    const suggestion = suggestMinScore(verdicts, 0.35);
    expect(suggestion).toMatchObject({ current: 0.35, suggested: 0.65, votes: 24, hiddenVotes: verdicts.length - 24 });
    expect(suggestion!.helpfulRate).toBeCloseTo(0.92, 2);
  });

  it('does not chase a threshold supported by only a handful of votes', () => {
    const verdicts = [...make(0.4, 2, 30), ...make(0.9, 4, 0)];
    expect(suggestMinScore(verdicts, 0.35)).toBeNull();
  });

  it('never proposes lowering the threshold or moving it by less than a step', () => {
    const verdicts = [...make(0.4, 0, 25), ...make(0.45, 0, 25)];
    expect(suggestMinScore(verdicts, 0.35)).toBeNull();
    for (const current of [0.5, 0.9]) {
      const suggestion = suggestMinScore([...make(0.5, 0, 30), ...make(0.95, 30, 0)], current);
      if (suggestion) expect(suggestion.suggested).toBeGreaterThan(current);
    }
  });

  it('is deterministic', () => {
    const verdicts = [...make(0.4, 1, 14), ...make(0.8, 22, 2)];
    expect(suggestMinScore(verdicts, 0.35)).toEqual(suggestMinScore([...verdicts].reverse(), 0.35));
  });
});

describe('detectRateAnomaly', () => {
  it('flags a surge relative to the weekly baseline', () => {
    expect(detectRateAnomaly(12, 16)).toEqual({ recent: 12, baselineWeekly: 4, ratio: 3 });
    expect(detectRateAnomaly(30, 8)).toMatchObject({ baselineWeekly: 2, ratio: 15 });
  });

  it('needs a minimum count and a real multiple', () => {
    expect(detectRateAnomaly(ANOMALY_MIN_INCIDENTS - 1, 0)).toBeNull();
    expect(detectRateAnomaly(11, 16)).toBeNull();
    expect(detectRateAnomaly(10, 40)).toBeNull();
  });

  it('treats a service with no history against a floor of one per week', () => {
    expect(detectRateAnomaly(5, 0)).toMatchObject({ baselineWeekly: 0, ratio: 5 });
    expect(detectRateAnomaly(2, 0)).toBeNull();
  });

  it('rejects non-finite input', () => {
    expect(detectRateAnomaly(Number.NaN, 5)).toBeNull();
    expect(detectRateAnomaly(9, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
