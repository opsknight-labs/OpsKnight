import { describe, expect, it } from 'vitest';
import { RESPONSE_LIMITS } from '@/lib/intelligence/contract';
import {
  MAX_NEGATIVE_LEAD_SECONDS,
  scoreCause,
  type CauseScoreInput,
} from '@/lib/intelligence/root-cause/scoring';
import { changeChanceFactor } from '@/lib/intelligence/root-cause/baseline';

/**
 * The probable-cause ranking is a heuristic ordering of hypotheses, never a claim of certainty. These cases
 * pin its edges: the lookback window, changes that land just after onset, nonsense input, the graph decay
 * and the confidence cap.
 */
const base: CauseScoreInput = {
  relation: 'SAME_SERVICE',
  depth: 0,
  leadSeconds: 60,
  kind: 'DEPLOY',
};
const windowSeconds = RESPONSE_LIMITS.causeLookbackMinutes * 60;
const zero = { confidence: 0, components: { proximity: 0, relation: 0, kind: 0 } };

describe('what counts as a candidate', () => {
  it('scores a change inside the lookback window and none outside it', () => {
    expect(scoreCause({ ...base, leadSeconds: windowSeconds }).confidence).toBeGreaterThan(0);
    expect(scoreCause({ ...base, leadSeconds: windowSeconds + 1 })).toEqual(zero);
  });

  it('still scores a rollout that started a few minutes after onset, but never above an earlier one', () => {
    const after = scoreCause({ ...base, leadSeconds: -MAX_NEGATIVE_LEAD_SECONDS });
    expect(after.confidence).toBeGreaterThan(0);
    expect(after.confidence).toBeLessThan(scoreCause({ ...base, leadSeconds: 0 }).confidence);
    expect(scoreCause({ ...base, leadSeconds: -MAX_NEGATIVE_LEAD_SECONDS - 1 })).toEqual(zero);
  });

  it.each([NaN, Infinity, -Infinity])('treats %s lead time as no candidate', leadSeconds => {
    expect(scoreCause({ ...base, leadSeconds })).toEqual(zero);
  });
});

describe('how candidates rank', () => {
  it('prefers a closer change, the same service, and a nearer upstream service', () => {
    expect(scoreCause({ ...base, leadSeconds: 60 }).confidence).toBeGreaterThan(
      scoreCause({ ...base, leadSeconds: 3_600 }).confidence
    );
    const upstream = (depth: number) =>
      scoreCause({ ...base, relation: 'UPSTREAM', depth }).confidence;
    expect(scoreCause(base).confidence).toBeGreaterThan(upstream(1));
    expect(upstream(1)).toBeGreaterThan(upstream(2));
    expect(upstream(2)).toBeGreaterThan(upstream(5));
  });

  it('treats an upstream depth of zero like one hop, so it never outranks the same service', () => {
    expect(scoreCause({ ...base, relation: 'UPSTREAM', depth: 0 }).confidence).toBe(
      scoreCause({ ...base, relation: 'UPSTREAM', depth: 1 }).confidence
    );
  });

  it('ranks a deploy above config, feature flag and infrastructure changes', () => {
    const by = (kind: CauseScoreInput['kind']) => scoreCause({ ...base, kind }).confidence;
    expect(by('DEPLOY')).toBeGreaterThan(by('CONFIG'));
    expect(by('CONFIG')).toBeGreaterThanOrEqual(by('FEATURE_FLAG'));
    expect(by('FEATURE_FLAG')).toBeGreaterThan(by('INFRA'));
  });

  it('weights a global change below one on the same service', () => {
    expect(scoreCause({ ...base, relation: 'GLOBAL' }).confidence).toBeLessThan(
      scoreCause(base).confidence
    );
  });

  it('never reports more than the configured ceiling, however good the match', () => {
    const best = scoreCause({ ...base, leadSeconds: 0, componentMatch: 1 });
    expect(best.confidence).toBeLessThanOrEqual(RESPONSE_LIMITS.maxCauseConfidence);
    expect(RESPONSE_LIMITS.maxCauseConfidence).toBeLessThan(1);
  });

  it('lets a component match raise confidence and clamps nonsense chance and match values', () => {
    const plain = scoreCause({ ...base, leadSeconds: 1_800 }).confidence;
    expect(
      scoreCause({ ...base, leadSeconds: 1_800, componentMatch: 1 }).confidence
    ).toBeGreaterThan(plain);
    expect(scoreCause({ ...base, leadSeconds: 1_800, componentMatch: 9 })).toEqual(
      scoreCause({ ...base, leadSeconds: 1_800, componentMatch: 1 })
    );
    expect(
      scoreCause({ ...base, leadSeconds: 1_800, chanceFactor: -5 }).confidence
    ).toBeGreaterThan(0);
    expect(scoreCause({ ...base, leadSeconds: 1_800, chanceFactor: 50 })).toEqual(
      scoreCause({ ...base, leadSeconds: 1_800, chanceFactor: 1 })
    );
  });

  it('scores a related incident below a deploy of the same distance', () => {
    expect(scoreCause({ ...base, kind: 'INCIDENT' }).confidence).toBeLessThan(
      scoreCause(base).confidence
    );
  });
});

describe('how often a source changes anyway (the baseline)', () => {
  it('trusts a source that rarely changes, and discounts one that changes constantly', () => {
    expect(changeChanceFactor(0)).toBe(1);
    expect(changeChanceFactor(1)).toBeGreaterThan(changeChanceFactor(50));
    expect(changeChanceFactor(10_000)).toBeCloseTo(0.1, 5);
  });

  it('never leaves the range 0.1 to 1, even for nonsense counts', () => {
    for (const count of [-5, 0, 1, 7, 100, 1e9, Number.NaN]) {
      const factor = changeChanceFactor(count);
      if (Number.isNaN(count)) continue; // a NaN count cannot come from a SQL count(*)
      expect(factor).toBeGreaterThanOrEqual(0.1);
      expect(factor).toBeLessThanOrEqual(1);
    }
    expect(changeChanceFactor(5, 0)).toBeGreaterThanOrEqual(0.1);
  });
});
