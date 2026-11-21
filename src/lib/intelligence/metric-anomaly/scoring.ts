import { RESPONSE_LIMITS, type ResponseWeights } from '../contract';
import { DEFAULT_RESPONSE_WEIGHTS } from '../root-cause/scoring';
import { METRIC_EVIDENCE_GRACE_MINUTES } from './contract';

/**
 * Ranks a metric anomaly as a lead for an incident. Pure. Like change scoring it combines time proximity and
 * graph distance, and it is capped below certainty: a metric that moved before an incident is a place to look,
 * not a proven cause. Two differences from changes: an anomaly that starts shortly after onset still counts
 * (metrics and alerts move together; the alert may simply have fired first), and a stronger deviation ranks
 * higher, from half weight at the template's threshold to full weight at twice the threshold.
 */

export const METRIC_EVIDENCE_WEIGHT = 0.85;

export interface MetricAnomalyScoreInput {
  relation: 'SAME_SERVICE' | 'UPSTREAM';
  depth: number;
  /** Seconds the anomaly started before onset; negative when it started after. */
  leadSeconds: number;
  score: number;
  thresholdMad: number;
  weights?: ResponseWeights;
}

export interface MetricAnomalyScore {
  confidence: number;
  components: { proximity: number; relation: number; strength: number };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function scoreMetricAnomaly(input: MetricAnomalyScoreInput): MetricAnomalyScore {
  const zero = { confidence: 0, components: { proximity: 0, relation: 0, strength: 0 } };
  if (
    !Number.isFinite(input.leadSeconds) ||
    input.leadSeconds < -METRIC_EVIDENCE_GRACE_MINUTES * 60 ||
    input.leadSeconds > RESPONSE_LIMITS.causeLookbackMinutes * 60
  )
    return zero;
  const weights = input.weights ?? DEFAULT_RESPONSE_WEIGHTS;
  const proximity = Math.exp(
    -Math.max(0, input.leadSeconds) / (RESPONSE_LIMITS.proximityTauMinutes * 60)
  );
  const relation =
    input.relation === 'SAME_SERVICE'
      ? 1
      : Math.pow(weights.upstreamDecay, Math.max(1, input.depth));
  const threshold = Math.max(1e-9, input.thresholdMad);
  const strength = Math.max(
    0.5,
    Math.min(1, 0.5 + (0.5 * (Math.abs(input.score) - threshold)) / threshold)
  );
  const confidence = Math.min(
    RESPONSE_LIMITS.maxCauseConfidence,
    proximity * relation * strength * METRIC_EVIDENCE_WEIGHT
  );
  return {
    confidence: round(confidence),
    components: {
      proximity: round(proximity),
      relation: round(relation),
      strength: round(strength),
    },
  };
}
