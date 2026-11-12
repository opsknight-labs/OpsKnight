import { describe, expect, it } from 'vitest';
import {
  adjustUrgencyForBurn,
  estimateResolution,
  evidenceFactor,
  weightedVote,
} from '@/lib/intelligence/triage/scoring';
import { scoreChangeRisk } from '@/lib/intelligence/changes/risk';
import { burnRate, classifyBurn, mergedDowntimeMinutes, rankByBurn } from '@/lib/slo/burn';
import {
  fitResponseWeights,
  type CauseExample,
} from '@/lib/intelligence/learning/response-weights';
import { DEFAULT_RESPONSE_WEIGHTS, scoreCause } from '@/lib/intelligence/root-cause/scoring';

describe('triage votes', () => {
  it('needs enough precedents and a majority, and scales confidence with evidence', () => {
    expect(weightedVote([{ value: 'HIGH', weight: 0.9 }])).toBeNull();
    const split = weightedVote([
      { value: 'HIGH', weight: 0.5 },
      { value: 'LOW', weight: 0.5 },
      { value: 'MEDIUM', weight: 0.3 },
    ]);
    expect(split).toBeNull();
    const clear = weightedVote([
      { value: 'HIGH', weight: 0.9 },
      { value: 'HIGH', weight: 0.8 },
      { value: 'LOW', weight: 0.2 },
    ]);
    expect(clear).toMatchObject({ value: 'HIGH', supporters: 2, voters: 3 });
    expect(clear!.share).toBeCloseTo(1.7 / 1.9, 2);
    expect(clear!.confidence).toBeLessThanOrEqual(0.9);
    expect(clear!.confidence).toBeCloseTo(Math.min(0.9, (1.7 / 1.9) * evidenceFactor(3)), 2);
  });

  it('ignores null values and zero weights', () => {
    expect(
      weightedVote([
        { value: null, weight: 1 },
        { value: 'A', weight: 0 },
        { value: 'A', weight: 1 },
        { value: 'A', weight: 1 },
        { value: 'A', weight: 1 },
      ])
    ).toMatchObject({ value: 'A', voters: 3 });
  });

  it('estimates resolution time as weighted quantiles and trusts tight precedents more', () => {
    const row = (minutes: number, weight = 1) => ({
      incidentId: String(minutes),
      weight,
      urgency: null,
      priority: null,
      teamId: null,
      assigneeId: null,
      resolutionMinutes: minutes,
    });
    expect(estimateResolution([row(10), row(20)])).toBeNull();
    // Weighted median takes the first sample whose cumulative weight reaches half: the lower median.
    const tight = estimateResolution([row(30), row(32), row(35), row(31)]);
    expect(tight).toMatchObject({
      expectedMinutes: 31,
      lowMinutes: 30,
      highMinutes: 32,
      samples: 4,
    });
    const loose = estimateResolution([row(5), row(30), row(300), row(900)]);
    expect(loose!.confidence).toBeLessThan(tight!.confidence);
    expect(loose!.lowMinutes).toBeLessThanOrEqual(loose!.expectedMinutes);
    expect(loose!.highMinutes).toBeGreaterThanOrEqual(loose!.expectedMinutes);
  });

  it('never lowers urgency on a burning service and raises a MEDIUM vote one step', () => {
    expect(adjustUrgencyForBurn('LOW', 'HIGH', false)).toBe('LOW');
    expect(adjustUrgencyForBurn('LOW', 'HIGH', true)).toBe('HIGH');
    expect(adjustUrgencyForBurn('MEDIUM', 'LOW', true)).toBe('HIGH');
    expect(adjustUrgencyForBurn('LOW', 'LOW', true)).toBe('MEDIUM');
  });
});

describe('change risk', () => {
  const base = {
    historicalFollowRate: null,
    historicalSample: 0,
    blastRadius: 0,
    hour: 11,
    weekday: 2,
    size: null,
    kind: 'DEPLOY' as const,
  };

  it('is a bounded ranking signal that grows with history, blast radius, off-hours and size', () => {
    const quiet = scoreChangeRisk(base);
    expect(quiet.score).toBeGreaterThan(0);
    expect(quiet.score).toBeLessThan(0.5);
    const risky = scoreChangeRisk({
      ...base,
      historicalFollowRate: 0.8,
      historicalSample: 20,
      blastRadius: 12,
      hour: 2,
      weekday: 6,
      size: { filesChanged: 120, linesChanged: 4000 },
    });
    expect(risky.score).toBeGreaterThan(quiet.score);
    expect(risky.score).toBeLessThanOrEqual(1);
    expect(risky.components.timing).toBe(1);
    expect(scoreChangeRisk({ ...base, hour: 23 }).components.timing).toBe(0.7);
  });

  it('shrinks a small sample towards the prior', () => {
    const one = scoreChangeRisk({ ...base, historicalFollowRate: 1, historicalSample: 1 });
    const many = scoreChangeRisk({ ...base, historicalFollowRate: 1, historicalSample: 50 });
    expect(one.components.history).toBeLessThan(many.components.history);
    expect(scoreChangeRisk({ ...base, kind: 'FEATURE_FLAG' }).score).toBeLessThan(
      scoreChangeRisk(base).score
    );
  });
});

describe('error-budget burn', () => {
  it('merges overlapping downtime and clips to the window', () => {
    const t = 1_000_000;
    const minutes = mergedDowntimeMinutes(
      [
        { start: t, end: t + 10 * 60_000 },
        { start: t + 5 * 60_000, end: t + 20 * 60_000 },
        { start: t + 40 * 60_000, end: t + 50 * 60_000 },
      ],
      t + 2 * 60_000,
      t + 45 * 60_000
    );
    expect(minutes).toBe(18 + 5);
  });

  it('computes burn against the error budget and classifies the classic thresholds', () => {
    // 99.9% target: budget 0.1%. 6 minutes down in an hour = 10% unavailable = burn 100.
    expect(burnRate(6, 60, 99.9)).toBe(100);
    expect(burnRate(0, 60, 99.9)).toBe(0);
    expect(classifyBurn(14.4, 0)).toBe('critical');
    expect(classifyBurn(8, 0)).toBe('warning');
    expect(classifyBurn(1, 1)).toBe('none');
    expect(
      rankByBurn([
        {
          serviceId: 'a',
          downtimeMinutes: { fast: 0, slow: 0 },
          objectives: [],
          burning: false,
          severity: 'none',
        },
        {
          serviceId: 'b',
          downtimeMinutes: { fast: 5, slow: 5 },
          objectives: [
            {
              objectiveId: 'o',
              name: 'x',
              targetPercent: 99.9,
              fastBurn: 20,
              slowBurn: 3,
              severity: 'critical',
            },
          ],
          burning: true,
          severity: 'critical',
        },
        null,
      ])
    ).toEqual(['b', 'a']);
  });
});

describe('cause-ranking weights', () => {
  it('scores with the shipped defaults when no weights are given, and honours overrides', () => {
    const shipped = scoreCause({ relation: 'UPSTREAM', depth: 2, leadSeconds: 60, kind: 'CONFIG' });
    const tuned = scoreCause({
      relation: 'UPSTREAM',
      depth: 2,
      leadSeconds: 60,
      kind: 'CONFIG',
      weights: {
        ...DEFAULT_RESPONSE_WEIGHTS,
        upstreamDecay: 1,
        kind: { ...DEFAULT_RESPONSE_WEIGHTS.kind, CONFIG: 1 },
      },
    });
    expect(tuned.confidence).toBeGreaterThan(shipped.confidence);
  });

  it('refuses to fit on too little feedback and only offers an improvement over the defaults', () => {
    expect(fitResponseWeights([])).toBeNull();
    // Feedback says global changes are usually helpful here, and two-hop upstream changes usually are
    // not: the defaults under-weight the former and over-weight the latter.
    const rows: CauseExample[] = [];
    for (let i = 0; i < 120; i += 1) {
      const global = i % 2 === 0;
      rows.push({
        kind: 'DEPLOY',
        relation: global ? 'GLOBAL' : 'UPSTREAM',
        depth: global ? 0 : 2,
        proximity: 0.7 + (i % 5) * 0.05,
        chance: 1,
        // A 7-cycle keeps both verdicts in the every-fifth held-out split.
        helpful: global ? i % 7 !== 0 : i % 7 === 0,
      });
    }
    const proposal = fitResponseWeights(rows);
    expect(proposal).not.toBeNull();
    expect(proposal!.weights.globalWeight).toBeGreaterThan(DEFAULT_RESPONSE_WEIGHTS.globalWeight);
    expect(proposal!.weights.upstreamDecay).toBeLessThan(DEFAULT_RESPONSE_WEIGHTS.upstreamDecay);
    expect(proposal!.heldOutLoss).toBeLessThan(proposal!.baselineLoss);
  });
});
