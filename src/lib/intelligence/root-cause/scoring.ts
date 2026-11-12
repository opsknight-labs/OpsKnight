import { RESPONSE_LIMITS, type ResponseWeights } from '../contract';

export type CauseRelation = 'SAME_SERVICE' | 'UPSTREAM' | 'GLOBAL';
export type ChangeKindValue = 'DEPLOY' | 'CONFIG' | 'FEATURE_FLAG' | 'INFRA';

/** Shipped defaults; a policy may carry offline-fitted replacements (see learning/response-weights). */
export const DEFAULT_RESPONSE_WEIGHTS: ResponseWeights = {
  kind: { DEPLOY: 1, CONFIG: 0.9, FEATURE_FLAG: 0.9, INFRA: 0.8 },
  upstreamDecay: 0.75,
  globalWeight: 0.4,
};

export interface CauseScoreInput {
  relation: CauseRelation;
  /** Hops from the affected service; 0 for the same service and for global changes. */
  depth: number;
  /** Seconds the candidate preceded incident onset. Negative or beyond the window scores zero. */
  leadSeconds: number;
  kind: ChangeKindValue | 'INCIDENT';
  chanceFactor?: number;
  componentMatch?: number;
  weights?: ResponseWeights;
}

export interface CauseScore {
  confidence: number;
  components: { proximity: number; relation: number; kind: number };
}

function relationWeight(relation: CauseRelation, depth: number, weights: ResponseWeights): number {
  if (relation === 'SAME_SERVICE') return 1;
  if (relation === 'GLOBAL') return weights.globalWeight;
  return Math.pow(weights.upstreamDecay, Math.max(1, depth));
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Ranks a candidate cause by how close in time and in the dependency graph it sits to the incident.
 * This is a heuristic ordering of hypotheses, deliberately capped below certainty: a change that
 * merely preceded an incident has not been shown to have caused it.
 */
export function scoreCause(input: CauseScoreInput): CauseScore {
  const windowSeconds = RESPONSE_LIMITS.causeLookbackMinutes * 60;
  if (
    !Number.isFinite(input.leadSeconds) ||
    input.leadSeconds < 0 ||
    input.leadSeconds > windowSeconds
  ) {
    return { confidence: 0, components: { proximity: 0, relation: 0, kind: 0 } };
  }
  const weights = input.weights ?? DEFAULT_RESPONSE_WEIGHTS;
  const proximity = Math.exp(-input.leadSeconds / (RESPONSE_LIMITS.proximityTauMinutes * 60));
  const relation = relationWeight(input.relation, input.depth, weights);
  const kind = input.kind === 'INCIDENT' ? 0.85 : weights.kind[input.kind];
  const chance = Math.max(0.1, Math.min(1, input.chanceFactor ?? 1));
  const component =
    input.componentMatch === undefined
      ? 1
      : 0.5 + 0.75 * Math.max(0, Math.min(1, input.componentMatch));
  const confidence = Math.min(
    RESPONSE_LIMITS.maxCauseConfidence,
    proximity * relation * kind * chance * component
  );
  return {
    confidence: round(confidence),
    components: { proximity: round(proximity), relation: round(relation), kind },
  };
}
