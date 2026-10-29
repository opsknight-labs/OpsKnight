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
}

export interface RankedRunbook extends RunbookOutcomeCounts {
  confidence: number;
}

/** Highest lower bound first; bound-but-untried runbooks come after proven ones; ties are stable by id. */
export function rankRunbooks(
  candidates: readonly RunbookOutcomeCounts[],
  limit: number
): RankedRunbook[] {
  return candidates
    .map(candidate => ({
      ...candidate,
      // A runbook that has fixed this exact problem before is judged on that record when it is the stronger
      // evidence; it is never penalised for it.
      confidence:
        Math.round(
          Math.max(
            wilsonLowerBound(candidate.succeeded, candidate.eligible),
            candidate.sameProblem
              ? wilsonLowerBound(candidate.sameProblem.succeeded, candidate.sameProblem.eligible)
              : 0
          ) * 1000
        ) / 1000,
    }))
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        Number(b.bound) - Number(a.bound) ||
        b.eligible - a.eligible ||
        a.runbookId.localeCompare(b.runbookId)
    )
    .slice(0, limit);
}
