/**
 * Per-step escalation outcomes over a window, read from the daily step-outcome rollup (never from raw
 * attempts). Shared by the policy insight producer and the per-step strip on the policy page.
 */
/* eslint-disable security/detect-object-injection -- Keys are step indexes and fixed outcome/reason codes. */
import type { Prisma } from '@prisma/client';
import { OPS_ROLLUPS, queryOpsRollup, type OpsRollupPoint } from '@/lib/metric-rollup';

export const STEP_OUTCOME_WINDOW_DAYS = 30;
/** Local hours counted as night for the "times out at night" insight: 22:00 to 06:59. */
export const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5, 6]);
/** Upper bound used for acknowledgements slower than the largest rollup bucket (120 minutes). */
const OVER_LAST_BUCKET = 121;
const READ_LIMIT = 10_000;

export interface StepOutcomeSummary {
  step: number;
  /** Pages that reached someone: acknowledged + timed out + unanswered. */
  paged: number;
  acked: number;
  timedOut: number;
  skipped: number;
  failed: number;
  /** Skip and failure reasons with their counts. */
  reasons: Record<string, number>;
  /** Acknowledgements per "within N minutes" bucket; key 121 = slower than two hours. */
  ackWithin: Record<number, number>;
  nightPaged: number;
  nightTimedOut: number;
  dayPaged: number;
  dayTimedOut: number;
}

function emptySummary(step: number): StepOutcomeSummary {
  return {
    step,
    paged: 0,
    acked: 0,
    timedOut: 0,
    skipped: 0,
    failed: 0,
    reasons: {},
    ackWithin: {},
    nightPaged: 0,
    nightTimedOut: 0,
    dayPaged: 0,
    dayTimedOut: 0,
  };
}

type Tags = {
  step?: number;
  outcome?: string;
  reason?: string | null;
  hour?: number;
  ackWithinMin?: number | null;
};

/** Folds rollup rows into one summary per step, ordered by step. Pure. */
export function summarizeStepOutcomes(points: readonly OpsRollupPoint[]): StepOutcomeSummary[] {
  const byStep = new Map<number, StepOutcomeSummary>();
  for (const point of points) {
    const tags = (point.tags ?? {}) as Tags;
    if (typeof tags.step !== 'number') continue;
    const summary = byStep.get(tags.step) ?? emptySummary(tags.step);
    byStep.set(tags.step, summary);
    const n = point.count;
    const night = typeof tags.hour === 'number' && NIGHT_HOURS.has(tags.hour);
    switch (tags.outcome) {
      case 'ACKED': {
        summary.acked += n;
        const bucket = tags.ackWithinMin ?? OVER_LAST_BUCKET;
        summary.ackWithin[bucket] = (summary.ackWithin[bucket] ?? 0) + n;
        break;
      }
      case 'TIMED_OUT':
        summary.timedOut += n;
        if (night) summary.nightTimedOut += n;
        else summary.dayTimedOut += n;
        break;
      case 'UNANSWERED':
        break;
      case 'SKIPPED':
      case 'FAILED':
        if (tags.outcome === 'SKIPPED') summary.skipped += n;
        else summary.failed += n;
        if (tags.reason) summary.reasons[tags.reason] = (summary.reasons[tags.reason] ?? 0) + n;
        continue;
      default:
        continue;
    }
    summary.paged += n;
    if (night) summary.nightPaged += n;
    else summary.dayPaged += n;
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

/**
 * The time within which `quantile` of acknowledgements arrived, in minutes, from the rollup buckets
 * (an upper bound: "75% within 10 minutes"). Null without acknowledgements; 121 means over two hours.
 */
export function ackMinutesQuantile(summary: StepOutcomeSummary, quantile: number): number | null {
  if (summary.acked === 0) return null;
  const target = summary.acked * quantile;
  let seen = 0;
  for (const bucket of Object.keys(summary.ackWithin)
    .map(Number)
    .sort((a, b) => a - b)) {
    seen += summary.ackWithin[bucket];
    if (seen >= target) return bucket;
  }
  return OVER_LAST_BUCKET;
}

/** The window the strip and the producer read: the last 30 complete UTC days. */
export function stepOutcomeWindow(now: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: new Date(to.getTime() - STEP_OUTCOME_WINDOW_DAYS * 86_400_000), to };
}

/** One bounded read on idx_metric_rollup_subject. `capped` when the read limit was reached. */
export async function loadPolicyStepOutcomes(
  policyId: string,
  now: Date,
  client?: Prisma.TransactionClient
): Promise<{ steps: StepOutcomeSummary[]; capped: boolean }> {
  const points = await queryOpsRollup(
    OPS_ROLLUPS.escalationStepOutcome,
    { ...stepOutcomeWindow(now), subjectKey: policyId, limit: READ_LIMIT },
    client
  );
  return { steps: summarizeStepOutcomes(points), capped: points.length >= READ_LIMIT };
}
