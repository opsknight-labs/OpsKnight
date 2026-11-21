import { DEFAULT_RUNBOOK_WEIGHTS, type RunbookWeights } from '../contract';

const Z_95 = 1.959964;

/**
 * Lower bound of the 95% Wilson score interval for a success rate. Ranking by the lower bound
 * rather than the raw rate stops a runbook that worked once out of once from outranking one that
 * worked 47 times out of 50.
 */
export function wilsonLowerBound(successes: number, total: number): number {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) return 0;
  const n = Math.floor(total);
  const p = Math.min(Math.max(successes, 0), n) / n;
  const z2 = Z_95 * Z_95;
  const centre = p + z2 / (2 * n);
  const margin = Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export interface RunbookOutcomeCounts {
  runbookId: string;
  succeeded: number;
  /** SUCCEEDED + FAILED + TIMED_OUT. Cancelled, unknown and in-flight executions say nothing about efficacy. */
  eligible: number;
  bound: boolean;
  /** Runs on incidents with the same masked title as this one: the runbook's record on this exact problem. */
  sameProblem?: { succeeded: number; eligible: number };
  /** Observed improvement versus this problem's mean MTTR, clamped to a small ranking bonus. */
  mttrImprovement?: number;
}

export interface RankedRunbook extends RunbookOutcomeCounts {
  confidence: number;
}

/** Features of one candidate as the ranker and the weight fitter both see them. */
export type RunbookScoreFeatures = Pick<
  RunbookOutcomeCounts,
  'succeeded' | 'eligible' | 'bound' | 'sameProblem' | 'mttrImprovement'
>;

/**
 * Confidence for one candidate: the stronger of its weighted service-wide and same-problem lower bounds (or a
 * small prior when it is bound but untried), with a bounded bonus for observed MTTR improvement. A runbook
 * that has fixed this exact problem before is never penalised for it.
 */
export function scoreRunbook(
  candidate: RunbookScoreFeatures,
  weights: RunbookWeights = DEFAULT_RUNBOOK_WEIGHTS
): number {
  const base = Math.max(
    weights.overall * wilsonLowerBound(candidate.succeeded, candidate.eligible),
    candidate.sameProblem
      ? weights.sameProblem *
          wilsonLowerBound(candidate.sameProblem.succeeded, candidate.sameProblem.eligible)
      : 0,
    candidate.bound ? weights.boundPrior : 0
  );
  return Math.min(
    1,
    Math.round(
      base *
        (1 + weights.mttrBonus * Math.max(0, Math.min(1, candidate.mttrImprovement ?? 0))) *
        1000
    ) / 1000
  );
}

/** Highest lower bound first; bound-but-untried runbooks come after proven ones; ties are stable by id. */
export function rankRunbooks(
  candidates: readonly RunbookOutcomeCounts[],
  limit: number,
  weights: RunbookWeights = DEFAULT_RUNBOOK_WEIGHTS
): RankedRunbook[] {
  return candidates
    .map(candidate => ({ ...candidate, confidence: scoreRunbook(candidate, weights) }))
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        Number(b.bound) - Number(a.bound) ||
        b.eligible - a.eligible ||
        a.runbookId.localeCompare(b.runbookId)
    )
    .slice(0, limit);
}
