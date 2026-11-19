/* eslint-disable security/detect-object-injection -- All indexed keys come from the fixed FEATURES allowlist. */
import { SIMILARITY_WEIGHTS, type ScoringWeights } from '../similarity/scoring';

export interface ScoringExample extends ScoringWeights {
  helpful: boolean;
  /** Label time (ms). Rows without one keep their input position in the time order. */
  at?: number;
}
const FEATURES = ['content', 'labels', 'sameService', 'recency', 'resolved'] as const;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const loss = (rows: readonly ScoringExample[], weights: ScoringWeights) =>
  rows.reduce((sum, row) => {
    const score = FEATURES.reduce((n, key) => n + row[key] * weights[key], 0);
    const p = Math.max(1e-6, Math.min(1 - 1e-6, sigmoid(8 * (score - 0.5))));
    return sum - Math.log(row.helpful ? p : 1 - p);
  }, 0) / rows.length;

/** Offline only. Fit nonnegative logistic coefficients and offer them only if held-out loss improves. */
export function fitScoringWeights(examples: readonly ScoringExample[]) {
  const rows = examples.filter(row =>
    FEATURES.every(key => Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1)
  );
  if (
    rows.length < 50 ||
    rows.filter(row => row.helpful).length < 10 ||
    rows.filter(row => !row.helpful).length < 10
  )
    return null;
  // Time-based split: train on the oldest 80%, hold out the newest 20% so the check mimics deployment.
  const ordered = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.at ?? 0) - (b.row.at ?? 0) || a.i - b.i)
    .map(({ row }) => row);
  const cut = Math.floor(ordered.length * 0.8);
  const train = ordered.slice(0, cut);
  const held = ordered.slice(cut);
  if (new Set(held.map(row => row.helpful)).size < 2) return null;
  const weights: ScoringWeights = { ...SIMILARITY_WEIGHTS };
  for (let iteration = 0; iteration < 300; iteration++) {
    const gradients: ScoringWeights = {
      content: 0,
      labels: 0,
      sameService: 0,
      recency: 0,
      resolved: 0,
    };
    for (const row of train) {
      const prediction = sigmoid(
        8 * (FEATURES.reduce((n, key) => n + weights[key] * row[key], 0) - 0.5)
      );
      for (const key of FEATURES)
        gradients[key] += ((prediction - Number(row.helpful)) * row[key]) / train.length;
    }
    for (const key of FEATURES)
      weights[key] = Math.max(
        0,
        weights[key] - 0.05 * (gradients[key] + 0.01 * (weights[key] - SIMILARITY_WEIGHTS[key]))
      );
    const total = FEATURES.reduce((n, key) => n + weights[key], 0);
    for (const key of FEATURES) weights[key] /= total || 1;
    if (weights.content < 0.4) {
      const remainder = 1 - weights.content;
      for (const key of FEATURES) if (key !== 'content') weights[key] *= 0.6 / remainder;
      weights.content = 0.4;
    }
  }
  const heldOutLoss = loss(held, weights);
  const baselineLoss = loss(held, SIMILARITY_WEIGHTS);
  return heldOutLoss < baselineLoss - 0.01
    ? { weights, heldOutLoss, baselineLoss, support: rows.length }
    : null;
}
