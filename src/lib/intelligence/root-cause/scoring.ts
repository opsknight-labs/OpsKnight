import { RESPONSE_LIMITS } from '../contract';

export type CauseRelation = 'SAME_SERVICE' | 'UPSTREAM' | 'GLOBAL';
export type ChangeKindValue = 'DEPLOY' | 'CONFIG' | 'FEATURE_FLAG' | 'INFRA';

const KIND_WEIGHT: Record<ChangeKindValue, number> = {
  DEPLOY: 1,
  CONFIG: 0.9,
  FEATURE_FLAG: 0.9,
  INFRA: 0.8,
};

const GLOBAL_WEIGHT = 0.4;
const UPSTREAM_DECAY = 0.75;

export interface CauseScoreInput {
  relation: CauseRelation;
  /** Hops from the affected service; 0 for the same service and for global changes. */
  depth: number;
  /** Seconds the candidate preceded incident onset. Negative or beyond the window scores zero. */
  leadSeconds: number;
  kind: ChangeKindValue | 'INCIDENT';
}

export interface CauseScore {
  confidence: number;
  components: { proximity: number; relation: number; kind: number };
}

function relationWeight(relation: CauseRelation, depth: number): number {
  if (relation === 'SAME_SERVICE') return 1;
  if (relation === 'GLOBAL') return GLOBAL_WEIGHT;
  return Math.pow(UPSTREAM_DECAY, Math.max(1, depth));
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Ranks a candidate cause by how close in time and in the dependency graph it sits to the incident.
 * This is a heuristic ordering of hypotheses, deliberately capped below certainty: a change that
 * merely preceded an incident has not been shown to have caused it.
 */
export function scoreCause(input: CauseScoreInput): CauseScore {
  const windowSeconds = RESPONSE_LIMITS.causeLookbackMinutes * 60;
  if (!Number.isFinite(input.leadSeconds) || input.leadSeconds < 0 || input.leadSeconds > windowSeconds) {
    return { confidence: 0, components: { proximity: 0, relation: 0, kind: 0 } };
  }
  const proximity = Math.exp(-input.leadSeconds / (RESPONSE_LIMITS.proximityTauMinutes * 60));
  const relation = relationWeight(input.relation, input.depth);
  const kind = input.kind === 'INCIDENT' ? 0.85 : KIND_WEIGHT[input.kind];
  const confidence = Math.min(RESPONSE_LIMITS.maxCauseConfidence, proximity * relation * kind);
  return { confidence: round(confidence), components: { proximity: round(proximity), relation: round(relation), kind } };
}
