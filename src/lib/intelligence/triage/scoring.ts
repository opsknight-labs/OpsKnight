import { RESPONSE_LIMITS } from '../contract';

/**
 * Pure triage arithmetic. Every suggestion is a weighted vote over resolved precedents (the incident's
 * similar-incident findings), where a precedent's weight is its similarity score. Nothing here is a
 * calibrated probability: confidence is the share of the vote the winning option received, scaled by how
 * much evidence there was, and capped below certainty.
 */

export interface TriagePrecedent {
  incidentId: string;
  /** Similarity score, 0..1. */
  weight: number;
  urgency: string | null;
  priority: string | null;
  teamId: string | null;
  assigneeId: string | null;
  /** Minutes from open to resolve; null when not resolved. */
  resolutionMinutes: number | null;
}

export interface VoteResult<T extends string> {
  value: T;
  /** Share of total weight behind the winner, 0..1. */
  share: number;
  /** Precedents that voted for the winner. */
  supporters: number;
  /** Precedents that voted at all. */
  voters: number;
  confidence: number;
}

export const MAX_TRIAGE_CONFIDENCE = 0.9;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Evidence grows with the number of voters; three precedents are worth half the full weight, ten nearly all. */
export function evidenceFactor(voters: number): number {
  if (voters <= 0) return 0;
  return 1 - Math.exp(-voters / 3);
}

/**
 * Weighted plurality vote. Returns null below the minimum number of precedents or when the winner has
 * less than half of the weight: a split vote is not a suggestion.
 */
export function weightedVote<T extends string>(
  options: ReadonlyArray<{ value: T | null; weight: number }>,
  minVoters: number = RESPONSE_LIMITS.triageMinPrecedents
): VoteResult<T> | null {
  const totals = new Map<T, { weight: number; count: number }>();
  let total = 0;
  let voters = 0;
  for (const option of options) {
    if (option.value === null || !Number.isFinite(option.weight) || option.weight <= 0) continue;
    const entry = totals.get(option.value) ?? { weight: 0, count: 0 };
    entry.weight += option.weight;
    entry.count += 1;
    totals.set(option.value, entry);
    total += option.weight;
    voters += 1;
  }
  if (voters < minVoters || total <= 0) return null;
  const [value, winner] = [...totals.entries()].sort(
    (a, b) => b[1].weight - a[1].weight || String(a[0]).localeCompare(String(b[0]))
  )[0];
  const share = winner.weight / total;
  if (share < 0.5) return null;
  return {
    value,
    share: round(share),
    supporters: winner.count,
    voters,
    confidence: round(Math.min(MAX_TRIAGE_CONFIDENCE, share * evidenceFactor(voters))),
  };
}

export interface ResolutionEstimate {
  /** Weighted median of precedent resolution times, in minutes. */
  expectedMinutes: number;
  /** Weighted lower and upper quartiles, in minutes. */
  lowMinutes: number;
  highMinutes: number;
  samples: number;
  confidence: number;
}

/** Weighted quantiles over resolved precedents; null below the minimum sample size. */
export function estimateResolution(
  precedents: readonly TriagePrecedent[],
  minSamples: number = RESPONSE_LIMITS.triageMinPrecedents
): ResolutionEstimate | null {
  const rows = precedents
    .filter(
      row =>
        row.resolutionMinutes !== null &&
        Number.isFinite(row.resolutionMinutes) &&
        row.resolutionMinutes >= 0 &&
        row.weight > 0
    )
    .map(row => ({ minutes: row.resolutionMinutes as number, weight: row.weight }))
    .sort((a, b) => a.minutes - b.minutes);
  if (rows.length < minSamples) return null;
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const quantile = (q: number) => {
    let acc = 0;
    for (const row of rows) {
      acc += row.weight;
      if (acc / total >= q) return row.minutes;
    }
    return rows[rows.length - 1].minutes;
  };
  const expected = quantile(0.5);
  const low = quantile(0.25);
  const high = quantile(0.75);
  // A wide spread is weak evidence: tight precedents earn more confidence than scattered ones.
  const spread = expected > 0 ? Math.min(1, (high - low) / Math.max(1, expected)) : 1;
  return {
    expectedMinutes: Math.round(expected),
    lowMinutes: Math.round(low),
    highMinutes: Math.round(high),
    samples: rows.length,
    confidence: round(
      Math.min(MAX_TRIAGE_CONFIDENCE, evidenceFactor(rows.length) * (1 - 0.5 * spread))
    ),
  };
}

export type UrgencyValue = 'LOW' | 'MEDIUM' | 'HIGH';
const urgencyRank = (urgency: UrgencyValue) =>
  urgency === 'HIGH' ? 2 : urgency === 'MEDIUM' ? 1 : 0;

/**
 * The urgency a vote suggests, adjusted when the service is burning its error budget: a burning
 * service never gets a suggestion to lower urgency, and a MEDIUM vote is raised one step.
 */
export function adjustUrgencyForBurn(
  suggested: UrgencyValue,
  current: UrgencyValue,
  burning: boolean
): UrgencyValue {
  if (!burning) return suggested;
  const raised: UrgencyValue = suggested === 'LOW' ? 'MEDIUM' : 'HIGH';
  return urgencyRank(raised) < urgencyRank(current) ? current : raised;
}
