import { wilsonLowerBound } from '../recommendations/wilson';

export const MIN_FEEDBACK_FOR_SUGGESTION = 20;
/** The lower confidence bound on "helpful" that a threshold must clear to be proposed. */
export const TARGET_HELPFUL_LOWER_BOUND = 0.6;
const THRESHOLD_STEP = 0.05;
const THRESHOLD_CEILING = 0.9;
/** A proposal must move the threshold by at least this much, so noise never produces churn. */
const MIN_MOVE = 0.05;

export interface ScoredVerdict {
  /** The finding's ranking score at the time it was shown. */
  score: number;
  helpful: boolean;
}

export interface ScoreBucket {
  from: number;
  to: number;
  helpful: number;
  notHelpful: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Groups verdicts into fixed-width score buckets so the page can show where suggestions stop helping. */
export function bucketVerdicts(verdicts: readonly ScoredVerdict[], width = 0.1): ScoreBucket[] {
  const buckets = new Map<number, ScoreBucket>();
  for (const verdict of verdicts) {
    if (!Number.isFinite(verdict.score)) continue;
    // The epsilon keeps 0.6 / 0.1 (5.999…) in the 0.6 bucket despite floating-point error.
    const index = Math.min(Math.floor(Math.max(0, verdict.score) / width + 1e-9), Math.round(1 / width) - 1);
    let bucket = buckets.get(index);
    if (!bucket) {
      bucket = { from: round2(index * width), to: round2((index + 1) * width), helpful: 0, notHelpful: 0 };
      buckets.set(index, bucket);
    }
    if (verdict.helpful) bucket.helpful += 1;
    else bucket.notHelpful += 1;
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, bucket]) => bucket);
}

export interface MinScoreSuggestion {
  suggested: number;
  current: number;
  /** Verdicts at or above the suggested threshold. */
  votes: number;
  helpfulRate: number;
  /** Verdicts below it, which the change would stop showing. */
  hiddenVotes: number;
}

/**
 * Proposes raising the similarity threshold when low-scoring suggestions are mostly unhelpful. It is only
 * ever a proposal: a person applies it, creating a new audited policy version. It needs enough feedback
 * to be meaningful and judges each candidate threshold by the Wilson lower bound, so a handful of
 * thumbs-up cannot justify a change.
 */
export function suggestMinScore(verdicts: readonly ScoredVerdict[], currentMinScore: number): MinScoreSuggestion | null {
  const usable = verdicts.filter(verdict => Number.isFinite(verdict.score));
  if (usable.length < MIN_FEEDBACK_FOR_SUGGESTION) return null;
  const rateAt = (threshold: number) => {
    const kept = usable.filter(verdict => verdict.score >= threshold);
    const helpful = kept.filter(verdict => verdict.helpful).length;
    return { votes: kept.length, helpful, lower: wilsonLowerBound(helpful, kept.length) };
  };
  // Already good enough as configured: nothing to propose.
  if (rateAt(currentMinScore).lower >= TARGET_HELPFUL_LOWER_BOUND) return null;
  for (let t = currentMinScore + THRESHOLD_STEP; t <= THRESHOLD_CEILING + 1e-9; t += THRESHOLD_STEP) {
    const threshold = round2(t);
    if (threshold - currentMinScore < MIN_MOVE - 1e-9) continue;
    const at = rateAt(threshold);
    // Too little left to judge; do not chase a threshold supported by a handful of votes.
    if (at.votes < MIN_FEEDBACK_FOR_SUGGESTION / 2) break;
    if (at.lower >= TARGET_HELPFUL_LOWER_BOUND) {
      return {
        suggested: threshold,
        current: currentMinScore,
        votes: at.votes,
        helpfulRate: round2(at.helpful / at.votes),
        hiddenVotes: usable.length - at.votes,
      };
    }
  }
  return null;
}
