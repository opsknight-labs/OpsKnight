import { wilsonLowerBound } from '../recommendations/wilson';

export const AUTO_QUALITY_THRESHOLDS = {
  predictions: 200,
  negativeLabels: 20,
  criticalLabels: 20,
  precision: 0.98,
  precisionLowerBound: 0.95,
  falseMergeRate: 0.01,
  recall: 0.5,
} as const;

export interface ReviewedPrediction {
  predicted: boolean;
  linked: boolean;
  critical: boolean;
  score: number;
}

/** Unreviewed pairs are never treated as negatives. These metrics describe the labelled sample only. */
export function measureQuality(rows: readonly ReviewedPrediction[]) {
  let truePositives = 0,
    falsePositives = 0,
    falseNegatives = 0,
    trueNegatives = 0;
  for (const row of rows) {
    if (row.predicted && row.linked) truePositives++;
    else if (row.predicted) falsePositives++;
    else if (row.linked) falseNegatives++;
    else trueNegatives++;
  }
  const predictions = truePositives + falsePositives;
  const critical = rows.filter(row => row.critical);
  const criticalFalseMerges = critical.filter(row => row.predicted && !row.linked).length;
  const calibration = Array.from({ length: 10 }, (_, index) => {
    const sample = rows.filter(
      row => Math.min(9, Math.floor(Math.max(0, Math.min(1, row.score)) * 10)) === index
    );
    return {
      from: index / 10,
      to: (index + 1) / 10,
      count: sample.length,
      meanScore: sample.length
        ? sample.reduce((sum, row) => sum + row.score, 0) / sample.length
        : 0,
      observedPositiveRate: sample.length
        ? sample.filter(row => row.linked).length / sample.length
        : 0,
    };
  }).filter(bin => bin.count > 0);
  return {
    sampleCount: rows.length,
    predictions,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    negativeLabels: falsePositives + trueNegatives,
    criticalLabels: critical.length,
    criticalFalseMerges,
    precision: predictions ? truePositives / predictions : 0,
    precisionLowerBound: wilsonLowerBound(truePositives, predictions),
    recall: truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : 0,
    falseMergeRate: predictions ? falsePositives / predictions : 0,
    criticalFalseMergeRate: critical.length ? criticalFalseMerges / critical.length : 0,
    calibration,
  };
}
export type QualityMetrics = ReturnType<typeof measureQuality>;

export function assessAutoQuality(metrics: QualityMetrics): { allowed: boolean; reason: string } {
  const gate = AUTO_QUALITY_THRESHOLDS;
  if (
    metrics.predictions < gate.predictions ||
    metrics.negativeLabels < gate.negativeLabels ||
    metrics.criticalLabels < gate.criticalLabels
  ) {
    return {
      allowed: false,
      reason: `Needs ${gate.predictions} reviewed predictions, ${gate.negativeLabels} negative labels and ${gate.criticalLabels} critical-alert labels.`,
    };
  }
  if (metrics.criticalFalseMerges > 0)
    return { allowed: false, reason: 'Critical false merges must be zero.' };
  if (
    metrics.precision < gate.precision ||
    metrics.precisionLowerBound < gate.precisionLowerBound ||
    metrics.falseMergeRate > gate.falseMergeRate ||
    metrics.recall < gate.recall
  ) {
    return {
      allowed: false,
      reason: 'Reviewed precision, recall or false-merge thresholds are not met.',
    };
  }
  return {
    allowed: true,
    reason: 'Reviewed shadow-quality thresholds met for this service and policy.',
  };
}

export interface RuleQuality {
  ruleId: string;
  metrics: QualityMetrics;
  crossService: QualityMetrics;
}

/** Every enabled rule needs its own evidence; topology additionally needs cross-service evidence. */
export function assessRuleCoverage(
  rules: readonly { id: string; enabled: boolean; kind: string }[],
  measured: readonly RuleQuality[]
): { allowed: boolean; reason: string } {
  for (const rule of rules.filter(rule => rule.enabled)) {
    const row = measured.find(row => row.ruleId === rule.id);
    const samples = row
      ? [row.metrics, ...(rule.kind === 'TOPOLOGY' ? [row.crossService] : [])]
      : [];
    if (
      !samples.length ||
      samples.some(
        metrics =>
          metrics.predictions < 100 ||
          metrics.precision < 0.98 ||
          metrics.precisionLowerBound < 0.95 ||
          metrics.falseMergeRate > 0.01 ||
          metrics.criticalFalseMerges > 0
      )
    )
      return {
        allowed: false,
        reason: `Rule ${rule.id} needs passing reviewed evidence, including cross-service examples for topology.`,
      };
  }
  if (!rules.some(rule => rule.enabled))
    return { allowed: false, reason: 'No enabled correlation rules.' };
  return { allowed: true, reason: 'All enabled rules have passing reviewed evidence.' };
}
